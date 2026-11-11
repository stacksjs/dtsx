/// CLI entry point for zig-dtsx.
/// Reads TypeScript source from stdin or file, writes .d.ts to stdout or file.
/// Supports batch mode via --project <dir> --outdir <dir>.
const std = @import("std");
const platform = @import("platform.zig");
const builtin = @import("builtin");
const Scanner = @import("scanner.zig").Scanner;
const emitter = @import("emitter.zig");
const module_specifiers = @import("module_specifiers.zig");
const augmentation_graph = @import("augmentation_graph.zig");

// Platform-aware C stdio bindings.
//
// Zig 0.17 removed `@cImport` as a language builtin, so we declare every C
// symbol we need manually here instead of pulling them in from system
// headers. This also keeps cross-compilation working on CI runners where
// `addTranslateC` blows up with `CacheCheckFailed` for cross targets.
//
// Directory traversal uses the platform-aware std.Io filesystem API, except
// where platform.zig calls libc directly.
// Checked file operations retain UCRT stdio on Windows and stdio/openat(2)
// on POSIX (Linux and the BSD-derived Apple platforms). Stdio FILE* globals
// have different external symbol names
// across libcs (`stdin`/`stdout`/`stderr` on glibc/musl, `__stdinp` etc.
// on Apple), so we expose them as functions that resolve via `@extern`.
const c = if (builtin.os.tag == .windows) struct {
    pub const FILE = opaque {};
    pub extern "c" fn __acrt_iob_func(index: c_int) *FILE;
    pub extern "c" fn _fileno(stream: *FILE) c_int;
    pub extern "c" fn _setmode(fd: c_int, mode: c_int) c_int;
    pub extern "c" fn _wfopen(filename: [*:0]const u16, mode: [*:0]const u16) ?*FILE;
    pub extern "c" fn fclose(stream: *FILE) c_int;
    pub extern "c" fn fread(ptr: [*]u8, size: usize, nmemb: usize, stream: *FILE) usize;
    pub extern "c" fn fwrite(ptr: [*]const u8, size: usize, nmemb: usize, stream: *FILE) usize;
    pub extern "c" fn ferror(stream: *FILE) c_int;
    pub extern "c" fn fflush(stream: *FILE) c_int;
    pub extern "c" fn fseek(stream: *FILE, offset: c_long, whence: c_int) c_int;
    pub extern "c" fn ftell(stream: *FILE) c_long;
    pub const SEEK_END: c_int = 2;
    pub const SEEK_SET: c_int = 0;
} else struct {
    pub const FILE = opaque {};

    /// True when targeting a BSD-derived libc (Darwin, FreeBSD, DragonFly).
    /// These share the `__stdinp` / `__stdoutp` / `__stderrp` stdio symbol
    /// naming and the BSD-style hex `O_CREAT`/`O_TRUNC` flag values, both
    /// of which differ from glibc/musl Linux.
    const bsd_libc = builtin.os.tag.isDarwin() or
        builtin.os.tag == .freebsd or
        builtin.os.tag == .dragonfly;

    pub extern "c" fn fopen(path: [*:0]const u8, mode: [*:0]const u8) ?*FILE;
    pub extern "c" fn fclose(stream: *FILE) c_int;
    pub extern "c" fn fread(ptr: [*]u8, size: usize, nmemb: usize, stream: *FILE) usize;
    pub extern "c" fn fwrite(ptr: [*]const u8, size: usize, nmemb: usize, stream: *FILE) usize;
    pub extern "c" fn ferror(stream: *FILE) c_int;
    pub extern "c" fn fflush(stream: *FILE) c_int;
    pub extern "c" fn fseek(stream: *FILE, offset: c_long, whence: c_int) c_int;
    pub extern "c" fn ftell(stream: *FILE) c_long;
    pub const SEEK_SET: c_int = 0;
    pub const SEEK_END: c_int = 2;

    pub extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
    pub extern "c" fn openat(dirfd: c_int, path: [*:0]const u8, flags: c_int, ...) c_int;
    pub extern "c" fn close(fd: c_int) c_int;
    pub extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
    pub extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
    pub extern "c" fn lseek(fd: c_int, offset: c_long, whence: c_int) c_long;
    pub extern "c" fn ftruncate(fd: c_int, length: c_long) c_int;

    // fcntl.h flag values. BSD-derived libcs (Darwin/FreeBSD/DragonFly) use
    // hex bits; glibc/musl Linux use octal — these specific constants are
    // mutually inconsistent so we have to pick per OS.
    pub const O_RDONLY: c_int = 0;
    pub const O_WRONLY: c_int = 1;
    pub const O_RDWR: c_int = 2;
    pub const O_CREAT: c_int = if (bsd_libc) 0x0200 else 0o100;
    pub const O_TRUNC: c_int = if (bsd_libc) 0x0400 else 0o1000;

    // Stdio FILE* globals. The on-disk symbol names differ between BSD
    // libcs (`__stdinp` etc.) and glibc/musl (`stdin` etc.), so resolve
    // them via @extern. Exposed as functions so getStdioPtr's
    // "function-like" branch picks them up correctly.
    pub fn stdin() *FILE {
        const ptr = @extern(**FILE, .{ .name = if (bsd_libc) "__stdinp" else "stdin" });
        return ptr.*;
    }
    pub fn stdout() *FILE {
        const ptr = @extern(**FILE, .{ .name = if (bsd_libc) "__stdoutp" else "stdout" });
        return ptr.*;
    }
    pub fn stderr() *FILE {
        const ptr = @extern(**FILE, .{ .name = if (bsd_libc) "__stderrp" else "stderr" });
        return ptr.*;
    }
};

fn getStdout() *c.FILE {
    if (builtin.os.tag == .windows) return c.__acrt_iob_func(1);
    return getStdioPtr(c.stdout);
}

fn getStdin() *c.FILE {
    if (builtin.os.tag == .windows) return c.__acrt_iob_func(0);
    return getStdioPtr(c.stdin);
}

fn getStderr() *c.FILE {
    if (builtin.os.tag == .windows) return c.__acrt_iob_func(2);
    return getStdioPtr(c.stderr);
}

/// Resolve a C stdio handle that may be a pointer, optional pointer, or function.
/// All parameters are runtime-evaluated to avoid comptime issues on Linux.
inline fn getStdioPtr(val: anytype) *c.FILE {
    const T = @TypeOf(val);
    const info = @typeInfo(T);
    if (info == .optional) {
        return val.?;
    } else if (info == .pointer) {
        return @ptrCast(val);
    } else {
        // Function-like (e.g., macOS where stdout is a function)
        return val();
    }
}

fn writeStream(stream: *c.FILE, data: []const u8) !void {
    var offset: usize = 0;
    while (offset < data.len) {
        const written = c.fwrite(data[offset..].ptr, 1, data.len - offset, stream);
        if (written == 0) return error.OutputWriteFailure;
        offset += written;
    }
    if (c.ferror(stream) != 0) return error.OutputWriteFailure;
}

fn writeAll(data: []const u8) !void {
    try writeStream(getStdout(), data);
    if (c.fflush(getStdout()) != 0) return error.OutputWriteFailure;
}

fn writeErr(data: []const u8) void {
    _ = c.fwrite(data.ptr, 1, data.len, getStderr());
}

/// Preserve Windows filename identity rather than passing UTF-8 through the
/// active ANSI codepage. File reads/writes retain the checked stdio lifecycle.
fn openFilePath(alloc: std.mem.Allocator, path: []const u8, mode: [:0]const u8) !?*c.FILE {
    if (builtin.os.tag == .windows) {
        const wide_path = try std.unicode.wtf8ToWtf16LeAllocZ(alloc, path);
        defer alloc.free(wide_path);
        const wide_mode = try std.unicode.wtf8ToWtf16LeAllocZ(alloc, mode);
        defer alloc.free(wide_mode);
        return c._wfopen(wide_path.ptr, wide_mode.ptr);
    }
    const path_z = try alloc.dupeSentinel(u8, path, 0);
    defer alloc.free(path_z);
    return c.fopen(path_z.ptr, mode.ptr);
}

fn readFile(alloc: std.mem.Allocator, path: []const u8) ![]const u8 {
    const fp = (try openFilePath(alloc, path, "rb")) orelse return error.InputReadFailure;
    var closed = false;
    defer if (!closed) {
        _ = c.fclose(fp);
    };

    if (c.fseek(fp, 0, c.SEEK_END) != 0) return error.InputReadFailure;
    const tell_result = c.ftell(fp);
    if (tell_result < 0) return error.InputReadFailure;
    const size: usize = @intCast(tell_result);
    if (c.fseek(fp, 0, c.SEEK_SET) != 0) return error.InputReadFailure;

    const buf = try alloc.alloc(u8, size);
    errdefer alloc.free(buf);
    const read = c.fread(buf.ptr, 1, size, fp);
    if (read != size or c.ferror(fp) != 0) return error.InputReadFailure;
    const close_result = c.fclose(fp);
    closed = true;
    if (close_result != 0) return error.InputReadFailure;
    return buf;
}

fn readStdin(alloc: std.mem.Allocator) ![]const u8 {
    var buf = std.array_list.Managed(u8).init(alloc);
    errdefer buf.deinit();
    var read_buf: [4096]u8 = undefined;
    while (true) {
        const n = c.fread(&read_buf, 1, read_buf.len, getStdin());
        if (n == 0) {
            if (c.ferror(getStdin()) != 0) return error.InputReadFailure;
            break;
        }
        try buf.appendSlice(read_buf[0..n]);
    }
    return try buf.toOwnedSlice();
}

/// Whether the file open at `fd`, which is `size` bytes long, holds `data`.
fn fileHolds(fd: c_int, size: c_long, data: []const u8) bool {
    if (size != @as(c_long, @intCast(data.len)) or c.lseek(fd, 0, c.SEEK_SET) != 0) return false;
    var buffer: [64 * 1024]u8 = undefined;
    var compared: usize = 0;
    while (compared < data.len) {
        const count = c.read(fd, &buffer, @min(buffer.len, data.len - compared));
        if (count <= 0) return false;
        const got: usize = @intCast(count);
        if (!std.mem.eql(u8, buffer[0..got], data[compared .. compared + got])) return false;
        compared += got;
    }
    return true;
}

/// Make the output file `name` (relative to `dir_fd`, or to the working
/// directory when `dir_fd` is null) hold exactly `data`.
///
/// A file that already holds `data` is left untouched, so a rebuild that
/// changes nothing keeps its modification time and does not wake watchers or
/// incremental builds downstream. Otherwise it is overwritten from its start
/// and cut only when it used to be longer: opening with O_TRUNC instead makes
/// the filesystem release the old blocks and allocate them again, about twice
/// the cost.
fn replaceFileContents(dir_fd: ?c_int, name: [*:0]const u8, data: []const u8) !void {
    const mode = @as(c_uint, 0o644);
    // Reading the old contents needs read access; a write-only file is
    // simply rewritten.
    var readable = true;
    var fd = if (dir_fd) |dir| c.openat(dir, name, c.O_RDWR | c.O_CREAT, mode) else c.open(name, c.O_RDWR | c.O_CREAT, mode);
    if (fd < 0) {
        readable = false;
        fd = if (dir_fd) |dir| c.openat(dir, name, c.O_WRONLY | c.O_CREAT, mode) else c.open(name, c.O_WRONLY | c.O_CREAT, mode);
    }
    if (fd < 0) return error.OutputWriteFailure;
    var closed = false;
    defer if (!closed) {
        _ = c.close(fd);
    };
    // A pipe or device has no end to seek to, nothing to compare and nothing
    // to cut.
    const previous_end = c.lseek(fd, 0, c.SEEK_END);
    const unchanged = readable and previous_end > 0 and fileHolds(fd, previous_end, data);
    if (!unchanged) {
        if (previous_end >= 0 and c.lseek(fd, 0, c.SEEK_SET) != 0) return error.OutputWriteFailure;
        var offset: usize = 0;
        while (offset < data.len) {
            const count = c.write(fd, data.ptr + offset, data.len - offset);
            if (count <= 0) return error.OutputWriteFailure;
            offset += @as(usize, @intCast(count));
        }
        if (previous_end > @as(c_long, @intCast(data.len)) and c.ftruncate(fd, @intCast(data.len)) != 0) return error.OutputWriteFailure;
    }
    const close_result = c.close(fd);
    closed = true;
    if (close_result != 0) return error.OutputWriteFailure;
}

fn writeFile(alloc: std.mem.Allocator, path: []const u8, data: []const u8) !void {
    if (builtin.os.tag != .windows) {
        const path_z = try alloc.dupeSentinel(u8, path, 0);
        defer alloc.free(path_z);
        const with_newline = try alloc.alloc(u8, data.len + 1);
        defer alloc.free(with_newline);
        @memcpy(with_newline[0..data.len], data);
        with_newline[data.len] = '\n';
        return replaceFileContents(null, path_z.ptr, with_newline);
    }
    // As on POSIX, a file that already holds this declaration is left alone.
    if (readFile(alloc, path)) |existing| {
        defer alloc.free(existing);
        if (existing.len == data.len + 1 and existing[data.len] == '\n' and std.mem.eql(u8, existing[0..data.len], data)) return;
    } else |_| {}
    const fp = (try openFilePath(alloc, path, "wb")) orelse return error.OutputWriteFailure;
    var closed = false;
    defer if (!closed) {
        _ = c.fclose(fp);
    };

    try writeStream(fp, data);
    try writeStream(fp, "\n");
    if (c.fflush(fp) != 0) return error.OutputWriteFailure;
    const close_result = c.fclose(fp);
    closed = true;
    if (close_result != 0) return error.OutputWriteFailure;
}

fn samePath(left: []const u8, right: []const u8) bool {
    return if (builtin.os.tag == .windows) std.ascii.eqlIgnoreCase(left, right) else std.mem.eql(u8, left, right);
}

fn withinPath(path: []const u8, root: []const u8) bool {
    const prefix = std.mem.trimEnd(u8, root, if (builtin.os.tag == .windows) "\\/" else "/");
    return path.len >= prefix.len and samePath(path[0..prefix.len], prefix) and
        (path.len == prefix.len or std.fs.path.isSep(path[prefix.len]));
}

fn fileOrder(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.lessThan(u8, left, right);
}

/// Discover relative source paths without following directory symlinks. The
/// output tree is identified physically, including when roots use aliases.
/// Whether a directory is never searched for sources.
fn isSkippedDirectory(name: []const u8) bool {
    return std.mem.eql(u8, name, "node_modules") or std.mem.eql(u8, name, ".git") or std.mem.eql(u8, name, ".dtsx-cache");
}

/// `collectTsFiles` on libc directory streams (see platform.zig).
fn collectTsFilesDirect(alloc: std.mem.Allocator, dir_path: []const u8, out_path: []const u8) ![][]const u8 {
    const source_root = platform.realPath(alloc, dir_path) catch return error.DirNotFound;
    defer alloc.free(source_root);
    const output_root = try platform.realPath(alloc, out_path);
    defer alloc.free(output_root);
    const exclude_output = !samePath(source_root, output_root) and withinPath(output_root, source_root);
    var files = std.array_list.Managed([]const u8).init(alloc);
    errdefer {
        for (files.items) |name| alloc.free(name);
        files.deinit();
    }
    // Directories still to list, as paths relative to the root ("" is the root).
    var pending = std.array_list.Managed([]const u8).init(alloc);
    defer {
        for (pending.items) |relative| alloc.free(relative);
        pending.deinit();
    }
    try pending.append(try alloc.dupe(u8, ""));
    while (pending.pop()) |relative| {
        defer alloc.free(relative);
        const directory_z = if (relative.len == 0) try alloc.dupeSentinel(u8, dir_path, 0) else try std.fmt.allocPrintSentinel(alloc, "{s}/{s}", .{ dir_path, relative }, 0);
        defer alloc.free(directory_z);
        var listing = platform.Listing.open(directory_z) catch |err| return if (relative.len == 0) error.DirNotFound else err;
        defer listing.close();
        while (try listing.next(alloc)) |entry| {
            const entry_path = if (relative.len == 0) try alloc.dupe(u8, entry.name) else try std.fmt.allocPrint(alloc, "{s}/{s}", .{ relative, entry.name });
            var keep = false;
            defer if (!keep) alloc.free(entry_path);
            if (entry.kind == .directory) {
                if (isSkippedDirectory(entry.name)) continue;
                if (exclude_output) {
                    const full_path = try std.fs.path.resolve(alloc, &.{ source_root, entry_path });
                    defer alloc.free(full_path);
                    if (withinPath(full_path, output_root)) continue;
                }
                try pending.append(entry_path);
                keep = true;
                continue;
            }
            if (!std.mem.endsWith(u8, entry.name, ".ts") or std.mem.endsWith(u8, entry.name, ".d.ts")) continue;
            if (entry.kind == .sym_link) {
                // Preserve unreadable file links as tasks, so checked reads report
                // their failures. Directory links never become recursive roots.
                const target_z = try std.fmt.allocPrintSentinel(alloc, "{s}/{s}", .{ dir_path, entry_path }, 0);
                defer alloc.free(target_z);
                if (platform.resolvesToDirectory(target_z.ptr)) continue;
            }
            try files.append(entry_path);
            keep = true;
        }
    }
    std.mem.sort([]const u8, files.items, {}, fileOrder);
    return files.toOwnedSlice();
}

const collectTsFiles = if (platform.direct_libc) collectTsFilesDirect else collectTsFilesPortable;

fn collectTsFilesPortable(alloc: std.mem.Allocator, dir_path: []const u8, out_path: []const u8) ![][]const u8 {
    const io = std.Io.Threaded.global_single_threaded.io();
    var root = std.Io.Dir.cwd().openDir(io, dir_path, .{ .iterate = true }) catch return error.DirNotFound;
    defer root.close(io);
    const source_root = try std.Io.Dir.cwd().realPathFileAlloc(io, dir_path, alloc);
    defer alloc.free(source_root);
    const output_root = try std.Io.Dir.cwd().realPathFileAlloc(io, out_path, alloc);
    defer alloc.free(output_root);
    const exclude_output = !samePath(source_root, output_root) and withinPath(output_root, source_root);
    var files = std.array_list.Managed([]const u8).init(alloc);
    errdefer {
        for (files.items) |name| alloc.free(name);
        files.deinit();
    }
    var walker = try root.walkSelectively(alloc);
    defer walker.deinit();
    while (try walker.next(io)) |value| {
        var entry = value;
        if (entry.kind == .unknown) entry.kind = (try entry.dir.statFile(io, entry.basename, .{ .follow_symlinks = false })).kind;
        if (entry.kind == .directory) {
            if (isSkippedDirectory(entry.basename)) continue;
            if (exclude_output) {
                const full_path = try std.fs.path.resolve(alloc, &.{ source_root, entry.path });
                defer alloc.free(full_path);
                if (withinPath(full_path, output_root)) continue;
            }
            try walker.enter(io, entry);
            continue;
        }
        if (!std.mem.endsWith(u8, entry.basename, ".ts") or std.mem.endsWith(u8, entry.basename, ".d.ts")) continue;
        if (entry.kind == .sym_link) {
            // Preserve unreadable file links as tasks, so checked reads report
            // their failures. Directory links never become recursive roots.
            if (entry.dir.statFile(io, entry.basename, .{})) |target| {
                if (target.kind == .directory) continue;
            } else |_| {}
        }
        try files.append(try alloc.dupe(u8, entry.path));
    }
    std.mem.sort([]const u8, files.items, {}, fileOrder);
    return files.toOwnedSlice();
}

/// Per-file work item for threaded processing.
const FileTask = struct {
    input_name_z: [*:0]const u8,
    output_name_z: [*:0]const u8,
    keep_comments: bool,
    isolated_declarations: bool,
    source: []const u8 = "",
    context: ?module_specifiers.Context = null,
};

/// Thread context: directory fds + task slice.
const WorkerCtx = struct {
    output_dir_fd: c_int,
    tasks: []const FileTask,
    failures: []?anyerror,
};

fn readProjectSource(alloc: std.mem.Allocator, input_dir_fd: c_int, input_name_z: [*:0]const u8) ![]const u8 {
    return if (builtin.os.tag == .windows)
        try readFile(alloc, std.mem.span(input_name_z))
    else read_source: {
        const fd = c.openat(input_dir_fd, input_name_z, c.O_RDONLY);
        if (fd < 0) return error.InputReadFailure;
        var closed = false;
        defer if (!closed) {
            _ = c.close(fd);
        };
        const end_off = c.lseek(fd, 0, c.SEEK_END);
        if (end_off < 0 or c.lseek(fd, 0, c.SEEK_SET) < 0) return error.InputReadFailure;
        const size: usize = @intCast(end_off);
        const buf = try alloc.alloc(u8, size);
        var total: usize = 0;
        while (total < size) {
            const count = c.read(fd, @ptrCast(buf.ptr + total), size - total);
            if (count <= 0) return error.InputReadFailure;
            total += @as(usize, @intCast(count));
        }
        const close_result = c.close(fd);
        closed = true;
        if (close_result != 0) return error.InputReadFailure;
        break :read_source buf;
    };
}

/// One checked file operation. Emission completes before the destination opens.
/// This retains legacy direct publication; it is not a project transaction.
fn processFileTask(alloc: std.mem.Allocator, ctx: WorkerCtx, task: FileTask) !void {
    const default_import_order = [_][]const u8{"bun"};
    const source = task.source;

    var scanner = Scanner.init(alloc, source, task.keep_comments, task.isolated_declarations);
    scanner.setSourceFilename(if (task.context) |value| value.wire.sourceFile else std.mem.span(task.input_name_z));
    if (task.context) |value| scanner.inference_sources = value.wire.inferenceSources;
    _ = try scanner.scan();
    var context = task.context;
    const output = try emitter.processScannedDeclarations(
        alloc,
        alloc,
        scanner.declarations.items,
        source,
        task.keep_comments,
        &default_import_order,
        if (context) |*value| value else null,
        .{ .external_module = scanner.external_module },
    );

    if (builtin.os.tag == .windows) {
        try writeFile(alloc, std.mem.span(task.output_name_z), output);
    } else {
        // Preserve the existing NUL-allocation contract and trailing newline.
        @as([*]u8, @constCast(output.ptr))[output.len] = '\n';
        try replaceFileContents(ctx.output_dir_fd, task.output_name_z, output.ptr[0 .. output.len + 1]);
    }
}

/// Worker errors have one owned slot per task, inspected only after join.
/// Keep the existing native thread pool and bounded arena reuse.
fn workerFn(ctx: WorkerCtx) void {
    // malloc recycles a worker's buffers in user space. Taking them from the
    // page allocator maps and unmaps memory for every few files, and with
    // many workers those calls queue on the process's address-space lock.
    var arena = std.heap.ArenaAllocator.init(std.heap.c_allocator);
    defer arena.deinit();
    var files_since_reset: usize = 0;
    for (ctx.tasks, ctx.failures) |task, *failure| {
        processFileTask(arena.allocator(), ctx, task) catch |err| {
            failure.* = err;
        };
        files_since_reset += 1;
        if (files_since_reset >= 4) {
            _ = arena.reset(.retain_capacity);
            files_since_reset = 0;
        }
    }
}

/// Read context: one slice of tasks whose sources this thread snapshots.
const ReadCtx = struct {
    input_dir_fd: c_int,
    tasks: []FileTask,
    failures: []?anyerror,
};

/// Sources outlive the workers and are released with the process, so they
/// come from the thread-safe C allocator instead of the setup arena.
fn readWorkerFn(ctx: ReadCtx) void {
    for (ctx.tasks, ctx.failures) |*task, *failure| {
        task.source = readProjectSource(std.heap.c_allocator, ctx.input_dir_fd, task.input_name_z) catch |err| {
            failure.* = err;
            continue;
        };
    }
}

/// Threads worth starting for `file_count` files: each needs about 8 files to
/// amortize its ~100µs spawn and join.
fn projectThreadCount(file_count: usize) usize {
    return @min(platform.cpuCount(), @max(file_count / 8, 1));
}

/// Split `count` items into `parts` contiguous ranges of near-equal size.
fn partitionRange(count: usize, parts: usize, part: usize) struct { start: usize, end: usize } {
    const base = count / parts;
    const remainder = count % parts;
    const start = part * base + @min(part, remainder);
    return .{ .start = start, .end = start + base + @as(usize, if (part < remainder) 1 else 0) };
}

fn checkTaskFailures(tasks: []const FileTask, failures: []const ?anyerror) !void {
    for (tasks, failures) |task, failure| {
        if (failure) |err| {
            writeErr("error: ");
            writeErr(std.mem.span(task.input_name_z));
            writeErr(": ");
            writeErr(@errorName(err));
            writeErr("\n");
            return err;
        }
    }
}

/// Process all .ts files in a directory, writing .d.ts outputs to outdir.
/// Uses openat with directory fds (POSIX) and multi-threaded processing.
fn processProject(alloc: std.mem.Allocator, project_dir: []const u8, out_dir: []const u8, keep_comments: bool, isolated_declarations: bool) !void {
    _ = alloc;

    var setup_arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer setup_arena.deinit();
    const sa = setup_arena.allocator();

    // Prepare parent paths through the platform-aware filesystem API. Worker
    // stdio still checks writes, flushes and closes independently per file.
    try platform.makePath(sa, out_dir);
    const out_z = try sa.dupeSentinel(u8, out_dir, 0);

    // Open directory file descriptors for openat (POSIX only)
    var input_dir_fd: c_int = -1;
    var output_dir_fd: c_int = -1;
    if (builtin.os.tag != .windows) {
        const dir_z = try sa.dupeSentinel(u8, project_dir, 0);
        input_dir_fd = c.open(dir_z.ptr, c.O_RDONLY);
        if (input_dir_fd < 0) return error.DirNotFound;
        output_dir_fd = c.open(out_z.ptr, c.O_RDONLY);
        if (output_dir_fd < 0) {
            _ = c.close(input_dir_fd);
            return error.OutDirNotFound;
        }
    }
    defer if (builtin.os.tag != .windows) {
        _ = c.close(input_dir_fd);
        _ = c.close(output_dir_fd);
    };

    // Collect .ts filenames
    const filenames = try collectTsFiles(sa, project_dir, out_dir);
    var created_parent: ?[]const u8 = null;
    for (filenames) |filename| {
        if (std.fs.path.dirname(filename)) |parent| {
            // Sorted names put a directory's files together.
            if (created_parent) |previous| {
                if (std.mem.eql(u8, previous, parent)) continue;
            }
            try platform.makePath(sa, try std.fs.path.join(sa, &.{ out_dir, parent }));
            created_parent = parent;
        }
    }
    if (filenames.len == 0) return;

    // Build file tasks
    const tasks = try sa.alloc(FileTask, filenames.len);
    const failures = try sa.alloc(?anyerror, filenames.len);
    @memset(failures, null);
    if (builtin.os.tag == .windows) {
        for (filenames, 0..) |filename, idx| {
            const in_str = try std.fmt.allocPrint(sa, "{s}\\{s}", .{ project_dir, filename });
            const stem = filename[0 .. filename.len - 3];
            const out_str = try std.fmt.allocPrint(sa, "{s}\\{s}.d.ts", .{ out_dir, stem });
            tasks[idx] = .{
                .input_name_z = (try sa.dupeSentinel(u8, in_str, 0)).ptr,
                .output_name_z = (try sa.dupeSentinel(u8, out_str, 0)).ptr,
                .keep_comments = keep_comments,
                .isolated_declarations = isolated_declarations,
            };
        }
    } else {
        for (filenames, 0..) |filename, idx| {
            const name_z = try sa.dupeSentinel(u8, filename, 0);
            const stem = filename[0 .. filename.len - 3];
            const out_buf = try sa.alloc(u8, stem.len + 6);
            @memcpy(out_buf[0..stem.len], stem);
            @memcpy(out_buf[stem.len .. stem.len + 5], ".d.ts");
            out_buf[stem.len + 5] = 0;
            tasks[idx] = .{
                .input_name_z = name_z.ptr,
                .output_name_z = @ptrCast(out_buf.ptr),
                .keep_comments = keep_comments,
                .isolated_declarations = isolated_declarations,
            };
        }
    }

    // The standalone CLI owns source snapshots and its activation graph. Do not
    // plan one set of bytes and then re-read another set in worker threads.
    const source_root = try platform.realPath(sa, project_dir);
    const graph_files = try sa.alloc(augmentation_graph.File, tasks.len);
    // Every source is read exactly once, before planning, on as many threads
    // as the emission below uses.
    const thread_count = projectThreadCount(filenames.len);
    {
        const read_contexts = try sa.alloc(ReadCtx, thread_count);
        for (read_contexts, 0..) |*ctx, part| {
            const range = partitionRange(tasks.len, thread_count, part);
            ctx.* = .{ .input_dir_fd = input_dir_fd, .tasks = tasks[range.start..range.end], .failures = failures[range.start..range.end] };
        }
        try platform.runOnThreads(ReadCtx, readWorkerFn, sa, read_contexts);
    }
    for (filenames, failures) |filename, failure| {
        if (failure) |err| {
            writeErr("error: ");
            writeErr(filename);
            writeErr(": ");
            writeErr(@errorName(err));
            writeErr("\n");
            return err;
        }
    }
    for (tasks, filenames, 0..) |task, filename, index| {
        graph_files[index] = .{ .path = try std.fs.path.resolveAlloc(sa, &.{ source_root, filename }), .source = task.source };
    }
    var failed_source: ?[]const u8 = null;
    const required = augmentation_graph.plan(sa, graph_files, .{ .isolated_declarations = isolated_declarations, .failure_file = &failed_source }) catch |err| {
        if (failed_source) |path| {
            writeErr("error: ");
            writeErr(path);
            writeErr(": ");
            writeErr(@errorName(err));
            writeErr("\n");
        }
        return err;
    };
    for (tasks, graph_files, required) |*task, file, imports| {
        if (imports.len == 0) continue;
        var digest: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(file.source, &digest, .{});
        const hash = try sa.alloc(u8, 64);
        const hex = "0123456789abcdef";
        for (digest, 0..) |byte, index| {
            hash[index * 2] = hex[byte >> 4];
            hash[index * 2 + 1] = hex[byte & 15];
        }
        task.context = try module_specifiers.fromWire(.{
            .version = 1,
            .moduleSpecifierMode = "preserve",
            .sourceFile = file.path,
            .outputFile = std.mem.span(task.output_name_z),
            .sourceHash = hash,
            .rewrites = &.{},
            .augmentationImports = imports,
        }, file.source);
    }

    // Emit and write on the same number of threads.
    const contexts = try sa.alloc(WorkerCtx, thread_count);
    for (contexts, 0..) |*ctx, part| {
        const range = partitionRange(tasks.len, thread_count, part);
        ctx.* = .{ .output_dir_fd = output_dir_fd, .tasks = tasks[range.start..range.end], .failures = failures[range.start..range.end] };
    }
    try platform.runOnThreads(WorkerCtx, workerFn, sa, contexts);
    try checkTaskFailures(tasks, failures);
}

// Support both Zig 0.15.x (argsAlloc) and 0.16+ (Init.Minimal)
const has_process_init = @hasDecl(std.process, "Init");

pub const main = if (has_process_init) (if (platform.direct_libc) mainDirect else mainInit) else mainLegacy;

/// The standard panic handlers print through `std.Io`, which is what
/// platform.zig keeps out of the Darwin binary. This one prints the message
/// and aborts.
pub const panic = if (platform.direct_libc) std.debug.FullPanic(reportPanic) else std.debug.FullPanic(std.debug.defaultPanic);

/// The documented std.debug hook changes reporting, not fault-handler setup.
pub const debug = platform.Debug;

extern "c" fn exit(status: c_int) noreturn;
extern "c" fn abort() noreturn;

fn reportPanic(message: []const u8, first_trace_address: ?usize) noreturn {
    _ = first_trace_address;
    writeErr("panic: ");
    writeErr(message);
    writeErr("\n");
    abort();
}

/// Entry point where the binary avoids `std.Io`: report a failure the way the
/// standard entry point does (`error: Name`, status 1) without its tracing.
fn mainDirect(init: std.process.Init.Minimal) void {
    mainInit(init) catch |err| {
        writeErr("error: ");
        writeErr(@errorName(err));
        writeErr("\n");
        exit(1);
    };
}

fn mainInit(init: std.process.Init.Minimal) !void {
    const alloc = std.heap.c_allocator;
    var args_buf = std.array_list.Managed([]const u8).init(alloc);
    defer args_buf.deinit();
    var iter = if (builtin.os.tag == .windows)
        try std.process.Args.Iterator.initAllocator(init.args, alloc)
    else
        init.args.iterate();
    defer iter.deinit();
    while (iter.next()) |arg| {
        try args_buf.append(arg);
    }
    run(alloc, args_buf.items) catch |err| {
        if (err == error.UnsupportedValueFlow) writeErr("error: DTSX_UNSUPPORTED_VALUE_FLOW\n");
        return err;
    };
}

fn mainLegacy() !void {
    const alloc = std.heap.c_allocator;
    const raw_args = try std.process.argsAlloc(alloc);
    defer std.process.argsFree(alloc, raw_args);
    var args_buf = std.array_list.Managed([]const u8).init(alloc);
    defer args_buf.deinit();
    for (raw_args) |arg| {
        try args_buf.append(arg);
    }
    run(alloc, args_buf.items) catch |err| {
        if (err == error.UnsupportedValueFlow) writeErr("error: DTSX_UNSUPPORTED_VALUE_FLOW\n");
        return err;
    };
}

fn optionValue(args: []const []const u8, index: *usize) ![]const u8 {
    if (index.* + 1 >= args.len) return error.InvalidArguments;
    index.* += 1;
    const value = args[index.*];
    if (value.len == 0 or value[0] == '-') return error.InvalidArguments;
    return value;
}

const BatchRequest = struct {
    protocol: []const u8,
    version: u32,
    files: []const struct {
        source: []const u8,
        context: module_specifiers.WireContext,
    },
};

fn batchPathIdentity(alloc: std.mem.Allocator, path: []const u8) ![]const u8 {
    if (builtin.os.tag != .windows) return path;
    const key = try alloc.dupe(u8, path);
    for (key) |*byte| byte.* = if (byte.* == '/') '\\' else std.ascii.toLower(byte.*);
    return key;
}

/// A checked, source-snapshot protocol for an owning project's publisher. The
/// process writes no declaration files. Nonzero status invalidates the entire
/// response, including any prefix already streamed to stdout.
fn processBatchRequest(alloc: std.mem.Allocator, keep_comments: bool, isolated_declarations: bool) !void {
    const input = try readStdin(alloc);
    defer alloc.free(input);
    const parsed = std.json.parseFromSlice(BatchRequest, alloc, input, .{ .allocate = .alloc_always }) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return error.InvalidProjectRequest,
    };
    defer parsed.deinit();
    const request = parsed.value;
    if (!std.mem.eql(u8, request.protocol, "zig-dtsx-project") or request.version != 1) return error.UnsupportedProjectProtocol;
    var delivered = std.StringHashMap([]const u8).init(alloc);
    defer delivered.deinit();
    var identities = std.heap.ArenaAllocator.init(alloc);
    defer identities.deinit();
    var source_ids = std.StringHashMap(void).init(identities.allocator());
    var output_ids = std.StringHashMap(void).init(identities.allocator());
    // Validate all identities before emitting a response prefix.
    for (request.files) |file| {
        var context = try module_specifiers.fromWire(file.context, file.source);
        context.deinit();
        const source_id = try batchPathIdentity(identities.allocator(), file.context.sourceFile);
        const output_id = try batchPathIdentity(identities.allocator(), file.context.outputFile);
        if ((try source_ids.getOrPut(source_id)).found_existing or (try output_ids.getOrPut(output_id)).found_existing) return error.InvalidProjectRequest;
        try delivered.put(file.context.sourceFile, file.context.outputFile);
    }
    try writeAll("{\"protocol\":\"zig-dtsx-project\",\"version\":1,\"files\":[");
    for (request.files, 0..) |file, index| {
        var arena = std.heap.ArenaAllocator.init(alloc);
        defer arena.deinit();
        const a = arena.allocator();
        var context = try module_specifiers.fromWire(file.context, file.source);
        defer context.deinit();
        context.delivered_sources = &delivered;
        var scanner = Scanner.init(a, file.source, keep_comments, isolated_declarations);
        scanner.inference_sources = context.wire.inferenceSources;
        scanner.setSourceFilename(context.wire.sourceFile);
        _ = scanner.scan() catch |err| {
            writeErr("error: ");
            writeErr(file.context.sourceFile);
            writeErr(": ");
            writeErr(@errorName(err));
            writeErr("\n");
            return err;
        };
        const import_order = [_][]const u8{"bun"};
        const output = emitter.processScannedDeclarations(a, a, scanner.declarations.items, file.source, keep_comments, &import_order, &context, .{ .external_module = scanner.external_module }) catch |err| {
            writeErr("error: ");
            writeErr(file.context.sourceFile);
            writeErr(": ");
            writeErr(@errorName(err));
            writeErr("\n");
            return err;
        };
        const json = try std.json.Stringify.valueAlloc(a, .{
            .sourceFile = file.context.sourceFile,
            .outputFile = file.context.outputFile,
            .sourceHash = file.context.sourceHash,
            .content = output,
        }, .{});
        if (index > 0) try writeAll(",");
        try writeAll(json);
    }
    try writeAll("]}\n");
}

fn run(alloc: std.mem.Allocator, args: []const []const u8) !void {
    // Preserve exact source hashes and declaration bytes through Windows pipes.
    // UCRT's default text mode otherwise translates CRLF while reading stdin.
    if (builtin.os.tag == .windows) {
        if (c._setmode(c._fileno(getStdin()), 0x8000) < 0) return error.InputReadFailure;
        if (c._setmode(c._fileno(getStdout()), 0x8000) < 0) return error.OutputWriteFailure;
    }
    var input_file: ?[]const u8 = null;
    var output_file: ?[]const u8 = null;
    var project_dir: ?[]const u8 = null;
    var out_dir: ?[]const u8 = null;
    var context_file: ?[]const u8 = null;
    var batch = false;
    var keep_comments: bool = true;
    var isolated_declarations: bool = false;
    var show_help: bool = false;
    var positional_only = false;

    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (positional_only) {
            if (input_file != null or arg.len == 0) return error.InvalidArguments;
            input_file = arg;
        } else if (std.mem.eql(u8, arg, "--")) {
            positional_only = true;
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            show_help = true;
        } else if (std.mem.eql(u8, arg, "--no-comments")) {
            keep_comments = false;
        } else if (std.mem.eql(u8, arg, "--isolated-declarations")) {
            isolated_declarations = true;
        } else if (std.mem.eql(u8, arg, "--batch")) {
            if (batch) return error.InvalidArguments;
            batch = true;
        } else if (std.mem.eql(u8, arg, "-o") or std.mem.eql(u8, arg, "--output")) {
            if (output_file != null) return error.InvalidArguments;
            output_file = try optionValue(args, &i);
        } else if (std.mem.eql(u8, arg, "--project")) {
            if (project_dir != null) return error.InvalidArguments;
            project_dir = try optionValue(args, &i);
        } else if (std.mem.eql(u8, arg, "--outdir")) {
            if (out_dir != null) return error.InvalidArguments;
            out_dir = try optionValue(args, &i);
        } else if (std.mem.eql(u8, arg, "--context")) {
            if (context_file != null) return error.InvalidArguments;
            context_file = try optionValue(args, &i);
        } else if (arg.len > 0 and arg[0] != '-') {
            if (input_file != null) return error.InvalidArguments;
            input_file = arg;
        } else return error.InvalidArguments;
    }

    if (show_help) {
        try writeAll(
            \\zig-dtsx - Generate TypeScript declaration files
            \\
            \\Usage: zig-dtsx [options] [input-file]
            \\       zig-dtsx --project <dir> --outdir <dir>
            \\
            \\Options:
            \\  -h, --help        Show this help message
            \\  -o, --output FILE Write output to FILE instead of stdout
            \\  --project DIR     Process .ts sources recursively (batch mode)
            \\  --outdir DIR      Output directory for --project mode
            \\  --context FILE    Apply resolved project context to one source
            \\  --batch           Emit a resolved project request from stdin
            \\  --no-comments     Strip comments from output
            \\  --isolated-declarations  Skip initializer parsing when type annotations exist
            \\
            \\If no input file is specified, reads from stdin.
            \\
        );
        return;
    }

    if (batch) {
        if (input_file != null or output_file != null or project_dir != null or out_dir != null or context_file != null) return error.InvalidArguments;
        try processBatchRequest(alloc, keep_comments, isolated_declarations);
        return;
    }

    // Project mode: process entire directory
    if (project_dir) |dir| {
        if (input_file != null or output_file != null or context_file != null) return error.InvalidArguments;
        const outdir = out_dir orelse {
            writeErr("error: --project requires --outdir\n");
            return error.InvalidArguments;
        };
        try processProject(alloc, dir, outdir, keep_comments, isolated_declarations);
        return;
    }
    if (out_dir != null) return error.InvalidArguments;

    // Single-file mode
    const source = if (input_file) |path|
        try readFile(alloc, path)
    else
        try readStdin(alloc);
    defer alloc.free(source);
    var context: ?module_specifiers.Context = null;
    defer if (context) |*value| value.deinit();
    if (context_file) |path| {
        const json = try readFile(alloc, path);
        defer alloc.free(json);
        context = try module_specifiers.parse(alloc, json, source);
    }

    var arena = std.heap.ArenaAllocator.init(alloc);
    defer arena.deinit();
    const arena_alloc = arena.allocator();

    var scanner = Scanner.init(arena_alloc, source, keep_comments, isolated_declarations);
    if (context) |value| scanner.setSourceFilename(value.wire.sourceFile) else if (input_file) |path| scanner.setSourceFilename(path);
    _ = try scanner.scan();

    const default_import_order = [_][]const u8{"bun"};
    const dts_output = try emitter.processScannedDeclarations(
        arena_alloc,
        arena_alloc,
        scanner.declarations.items,
        source,
        keep_comments,
        &default_import_order,
        if (context) |*value| value else null,
        .{ .external_module = scanner.external_module },
    );

    if (output_file) |path| {
        try writeFile(alloc, path, dts_output);
    } else {
        try writeAll(dts_output);
        try writeAll("\n");
    }
}
