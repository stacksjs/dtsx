/// CLI entry point for zig-dtsx.
/// Reads TypeScript source from stdin or file, writes .d.ts to stdout or file.
/// Supports batch mode via --project <dir> --outdir <dir>.
const std = @import("std");
const builtin = @import("builtin");
const Scanner = @import("scanner.zig").Scanner;
const emitter = @import("emitter.zig");

// Platform-aware C stdio bindings.
// On Windows, @cImport fails because stdin/stdout are runtime function calls
// that Zig can't evaluate at comptime. We declare the extern functions manually.
const c = if (builtin.os.tag == .windows) struct {
    pub const FILE = opaque {};
    pub extern "c" fn __acrt_iob_func(index: c_int) *FILE;
    pub extern "c" fn fopen(filename: [*:0]const u8, mode: [*:0]const u8) ?*FILE;
    pub extern "c" fn fclose(stream: *FILE) c_int;
    pub extern "c" fn fread(ptr: [*]u8, size: usize, nmemb: usize, stream: *FILE) usize;
    pub extern "c" fn fwrite(ptr: [*]const u8, size: usize, nmemb: usize, stream: *FILE) usize;
    pub extern "c" fn fseek(stream: *FILE, offset: c_long, whence: c_int) c_int;
    pub extern "c" fn ftell(stream: *FILE) c_long;
    pub const SEEK_END: c_int = 2;
    pub const SEEK_SET: c_int = 0;

    // Windows directory iteration via UCRT _findfirst/_findnext
    pub const _finddata_t = extern struct {
        attrib: c_uint,
        time_create: isize,
        time_access: isize,
        time_write: isize,
        size: usize,
        name: [260]u8,
    };
    pub extern "c" fn _findfirst(filespec: [*:0]const u8, fileinfo: *_finddata_t) isize;
    pub extern "c" fn _findnext(handle: isize, fileinfo: *_finddata_t) c_int;
    pub extern "c" fn _findclose(handle: isize) c_int;
    pub extern "c" fn _mkdir(path: [*:0]const u8) c_int;
} else @cImport({
    @cInclude("stdio.h");
    @cInclude("stdlib.h");
    @cInclude("dirent.h");
    @cInclude("sys/stat.h");
    @cInclude("fcntl.h");
    @cInclude("unistd.h");
});

fn getStdout() *c.FILE {
    if (builtin.os.tag == .windows) {
        return c.__acrt_iob_func(1);
    } else {
        return switch (@typeInfo(@TypeOf(c.stdout))) {
            .optional => c.stdout.?,
            else => c.stdout(),
        };
    }
}

fn getStdin() *c.FILE {
    if (builtin.os.tag == .windows) {
        return c.__acrt_iob_func(0);
    } else {
        return switch (@typeInfo(@TypeOf(c.stdin))) {
            .optional => c.stdin.?,
            else => c.stdin(),
        };
    }
}

fn getStderr() *c.FILE {
    if (builtin.os.tag == .windows) {
        return c.__acrt_iob_func(2);
    } else {
        return switch (@typeInfo(@TypeOf(c.stderr))) {
            .optional => c.stderr.?,
            else => c.stderr(),
        };
    }
}

fn writeAll(data: []const u8) void {
    _ = c.fwrite(data.ptr, 1, data.len, getStdout());
}

fn writeErr(data: []const u8) void {
    _ = c.fwrite(data.ptr, 1, data.len, getStderr());
}

fn readFile(alloc: std.mem.Allocator, path: []const u8) ![]const u8 {
    const path_z = try alloc.dupeZ(u8, path);
    defer alloc.free(path_z);

    const fp = c.fopen(path_z.ptr, "rb") orelse return error.FileNotFound;
    defer _ = c.fclose(fp);

    _ = c.fseek(fp, 0, c.SEEK_END);
    const size: usize = @intCast(c.ftell(fp));
    _ = c.fseek(fp, 0, c.SEEK_SET);

    const buf = try alloc.alloc(u8, size);
    const read = c.fread(buf.ptr, 1, size, fp);
    return buf[0..read];
}

fn readStdin(alloc: std.mem.Allocator) ![]const u8 {
    var buf = std.array_list.Managed(u8).init(alloc);
    var read_buf: [4096]u8 = undefined;
    while (true) {
        const n = c.fread(&read_buf, 1, read_buf.len, getStdin());
        if (n == 0) break;
        try buf.appendSlice(read_buf[0..n]);
    }
    return try buf.toOwnedSlice();
}

fn writeFile(alloc: std.mem.Allocator, path: []const u8, data: []const u8) !void {
    const path_z = try alloc.dupeZ(u8, path);
    defer alloc.free(path_z);

    const fp = c.fopen(path_z.ptr, "wb") orelse return error.FileNotFound;
    defer _ = c.fclose(fp);

    _ = c.fwrite(data.ptr, 1, data.len, fp);
    _ = c.fwrite("\n", 1, 1, fp);
}

/// Collect .ts filenames from a directory (excluding .d.ts files).
fn collectTsFiles(alloc: std.mem.Allocator, dir_path: []const u8) ![][]const u8 {
    var files = std.array_list.Managed([]const u8).init(alloc);
    errdefer {
        for (files.items) |name| alloc.free(name);
        files.deinit();
    }

    if (builtin.os.tag == .windows) {
        // Windows: use _findfirst/_findnext
        const pattern_str = try std.fmt.allocPrint(alloc, "{s}\\*.ts", .{dir_path});
        const pattern = try alloc.dupeZ(u8, pattern_str);
        alloc.free(pattern_str);
        defer alloc.free(pattern);

        var fdata: c._finddata_t = undefined;
        const handle = c._findfirst(pattern.ptr, &fdata);
        if (handle == -1) return files.toOwnedSlice();
        defer _ = c._findclose(handle);

        while (true) {
            const name_ptr: [*:0]const u8 = @ptrCast(&fdata.name);
            const name = std.mem.span(name_ptr);
            if (std.mem.endsWith(u8, name, ".ts") and !std.mem.endsWith(u8, name, ".d.ts")) {
                try files.append(try alloc.dupe(u8, name));
            }
            if (c._findnext(handle, &fdata) != 0) break;
        }
    } else {
        // POSIX: use opendir/readdir
        const dir_z = try alloc.dupeZ(u8, dir_path);
        defer alloc.free(dir_z);

        const dir = c.opendir(dir_z.ptr) orelse return files.toOwnedSlice();
        defer _ = c.closedir(dir);

        while (c.readdir(dir)) |entry| {
            const name_ptr: [*:0]const u8 = @ptrCast(&entry.*.d_name);
            const name = std.mem.span(name_ptr);
            if (std.mem.endsWith(u8, name, ".ts") and !std.mem.endsWith(u8, name, ".d.ts")) {
                try files.append(try alloc.dupe(u8, name));
            }
        }
    }

    return files.toOwnedSlice();
}

/// Per-file work item for threaded processing.
const FileTask = struct {
    input_name_z: [*:0]const u8,
    output_name_z: [*:0]const u8,
    keep_comments: bool,
};

/// Thread context: directory fds + task slice.
const WorkerCtx = struct {
    input_dir_fd: c_int,
    output_dir_fd: c_int,
    tasks: []const FileTask,
};

/// Worker: read + process + write each file using thread-local arena.
/// Uses POSIX openat for directory-relative I/O (no path resolution overhead).
fn workerFn(ctx: WorkerCtx) void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const default_import_order = [_][]const u8{"bun"};

    for (ctx.tasks) |task| {
        const alloc = arena.allocator();

        if (builtin.os.tag == .windows) {
            // Windows: C stdio with full paths
            const fp = c.fopen(task.input_name_z, "rb") orelse {
                _ = arena.reset(.retain_capacity);
                continue;
            };
            _ = c.fseek(fp, 0, c.SEEK_END);
            const size: usize = @intCast(c.ftell(fp));
            _ = c.fseek(fp, 0, c.SEEK_SET);
            const buf = alloc.alloc(u8, size) catch {
                _ = c.fclose(fp);
                _ = arena.reset(.retain_capacity);
                continue;
            };
            const nread = c.fread(buf.ptr, 1, size, fp);
            _ = c.fclose(fp);

            var scanner = Scanner.init(alloc, buf[0..nread], task.keep_comments, false);
            _ = scanner.scan() catch {
                _ = arena.reset(.retain_capacity);
                continue;
            };
            const output = emitter.processDeclarations(
                alloc, scanner.declarations.items, buf[0..nread],
                task.keep_comments, &default_import_order,
            ) catch {
                _ = arena.reset(.retain_capacity);
                continue;
            };

            const out_fp = c.fopen(task.output_name_z, "wb") orelse {
                _ = arena.reset(.retain_capacity);
                continue;
            };
            _ = c.fwrite(output.ptr, 1, output.len, out_fp);
            _ = c.fwrite("\n", 1, 1, out_fp);
            _ = c.fclose(out_fp);
        } else {
            // POSIX: openat + read/write (no path resolution overhead)
            const fd = c.openat(ctx.input_dir_fd, task.input_name_z, c.O_RDONLY);
            if (fd < 0) {
                _ = arena.reset(.retain_capacity);
                continue;
            }
            var st: c.struct_stat = undefined;
            if (c.fstat(fd, &st) < 0) {
                _ = c.close(fd);
                _ = arena.reset(.retain_capacity);
                continue;
            }
            const size: usize = @intCast(st.st_size);
            const buf = alloc.alloc(u8, size) catch {
                _ = c.close(fd);
                _ = arena.reset(.retain_capacity);
                continue;
            };
            var total: usize = 0;
            while (total < size) {
                const n = c.read(fd, @ptrCast(buf.ptr + total), size - total);
                if (n <= 0) break;
                total += @as(usize, @intCast(n));
            }
            _ = c.close(fd);
            const source = buf[0..total];

            var scanner = Scanner.init(alloc, source, task.keep_comments, false);
            _ = scanner.scan() catch {
                _ = arena.reset(.retain_capacity);
                continue;
            };
            const output = emitter.processDeclarations(
                alloc, scanner.declarations.items, source,
                task.keep_comments, &default_import_order,
            ) catch {
                _ = arena.reset(.retain_capacity);
                continue;
            };

            // Combined write: data + "\n" in single syscall
            const combined = alloc.alloc(u8, output.len + 1) catch {
                _ = arena.reset(.retain_capacity);
                continue;
            };
            @memcpy(combined[0..output.len], output);
            combined[output.len] = '\n';

            const out_fd = c.openat(ctx.output_dir_fd, task.output_name_z,
                c.O_WRONLY | c.O_CREAT | c.O_TRUNC, @as(c_uint, 0o644));
            if (out_fd >= 0) {
                _ = c.write(out_fd, @ptrCast(combined.ptr), combined.len);
                _ = c.close(out_fd);
            }
        }

        _ = arena.reset(.retain_capacity);
    }
}

/// Process all .ts files in a directory, writing .d.ts outputs to outdir.
/// Uses openat with directory fds (POSIX) and multi-threaded processing.
fn processProject(alloc: std.mem.Allocator, project_dir: []const u8, out_dir: []const u8, keep_comments: bool) !void {
    _ = alloc;

    var setup_arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer setup_arena.deinit();
    const sa = setup_arena.allocator();

    // Ensure output directory exists
    const out_z = try sa.dupeZ(u8, out_dir);
    if (builtin.os.tag == .windows) {
        _ = c._mkdir(out_z.ptr);
    } else {
        _ = c.mkdir(out_z.ptr, 0o755);
    }

    // Open directory file descriptors for openat (POSIX only)
    var input_dir_fd: c_int = -1;
    var output_dir_fd: c_int = -1;
    if (builtin.os.tag != .windows) {
        const dir_z = try sa.dupeZ(u8, project_dir);
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
    const filenames = try collectTsFiles(sa, project_dir);
    if (filenames.len == 0) return;

    // Build file tasks
    const tasks = try sa.alloc(FileTask, filenames.len);
    if (builtin.os.tag == .windows) {
        for (filenames, 0..) |filename, idx| {
            const in_str = try std.fmt.allocPrint(sa, "{s}\\{s}", .{ project_dir, filename });
            const stem = filename[0 .. filename.len - 3];
            const out_str = try std.fmt.allocPrint(sa, "{s}\\{s}.d.ts", .{ out_dir, stem });
            tasks[idx] = .{
                .input_name_z = (try sa.dupeZ(u8, in_str)).ptr,
                .output_name_z = (try sa.dupeZ(u8, out_str)).ptr,
                .keep_comments = keep_comments,
            };
        }
    } else {
        for (filenames, 0..) |filename, idx| {
            const name_z = try sa.dupeZ(u8, filename);
            const stem = filename[0 .. filename.len - 3];
            const out_buf = try sa.alloc(u8, stem.len + 6);
            @memcpy(out_buf[0..stem.len], stem);
            @memcpy(out_buf[stem.len .. stem.len + 5], ".d.ts");
            out_buf[stem.len + 5] = 0;
            tasks[idx] = .{
                .input_name_z = name_z.ptr,
                .output_name_z = @ptrCast(out_buf.ptr),
                .keep_comments = keep_comments,
            };
        }
    }

    // Thread pool — use all CPU cores for mixed I/O + compute workload
    const cpu_count = std.Thread.getCpuCount() catch 4;
    const max_threads = @min(cpu_count, filenames.len);

    if (max_threads <= 1) {
        workerFn(.{ .input_dir_fd = input_dir_fd, .output_dir_fd = output_dir_fd, .tasks = tasks });
        return;
    }

    const files_per_thread = filenames.len / max_threads;
    const remainder = filenames.len % max_threads;
    const threads = try sa.alloc(std.Thread, max_threads);

    var spawned: usize = 0;
    var offset: usize = 0;
    for (0..max_threads) |t| {
        const count = files_per_thread + @as(usize, if (t < remainder) 1 else 0);
        const ctx = WorkerCtx{
            .input_dir_fd = input_dir_fd,
            .output_dir_fd = output_dir_fd,
            .tasks = tasks[offset .. offset + count],
        };
        offset += count;

        threads[t] = std.Thread.spawn(.{}, workerFn, .{ctx}) catch {
            workerFn(ctx);
            continue;
        };
        spawned += 1;
    }

    for (threads[0..spawned]) |th| {
        th.join();
    }
}

pub fn main(init: std.process.Init.Minimal) !void {
    // Use c_allocator directly (libc is already linked) — avoids GPA tracking overhead.
    // The arena wrapping this provides fast bump allocation; c_allocator is only
    // the backing allocator for large/rare requests.
    const alloc = std.heap.c_allocator;

    // Platform-aware args iteration (Windows requires initAllocator)
    var args_iter = if (builtin.os.tag == .windows)
        try std.process.Args.Iterator.initAllocator(init.args, alloc)
    else
        init.args.iterate();
    defer args_iter.deinit();

    var args_buf = std.array_list.Managed([]const u8).init(alloc);
    defer args_buf.deinit();
    while (args_iter.next()) |arg| {
        try args_buf.append(arg);
    }
    const args = args_buf.items;

    var input_file: ?[]const u8 = null;
    var output_file: ?[]const u8 = null;
    var project_dir: ?[]const u8 = null;
    var out_dir: ?[]const u8 = null;
    var keep_comments: bool = true;
    var isolated_declarations: bool = false;
    var show_help: bool = false;

    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            show_help = true;
        } else if (std.mem.eql(u8, arg, "--no-comments")) {
            keep_comments = false;
        } else if (std.mem.eql(u8, arg, "--isolated-declarations")) {
            isolated_declarations = true;
        } else if (std.mem.eql(u8, arg, "-o") or std.mem.eql(u8, arg, "--output")) {
            i += 1;
            if (i < args.len) output_file = args[i];
        } else if (std.mem.eql(u8, arg, "--project")) {
            i += 1;
            if (i < args.len) project_dir = args[i];
        } else if (std.mem.eql(u8, arg, "--outdir")) {
            i += 1;
            if (i < args.len) out_dir = args[i];
        } else if (arg.len > 0 and arg[0] != '-') {
            input_file = arg;
        }
    }

    if (show_help) {
        writeAll(
            \\zig-dtsx - Generate TypeScript declaration files
            \\
            \\Usage: zig-dtsx [options] [input-file]
            \\       zig-dtsx --project <dir> --outdir <dir>
            \\
            \\Options:
            \\  -h, --help        Show this help message
            \\  -o, --output FILE Write output to FILE instead of stdout
            \\  --project DIR     Process all .ts files in DIR (batch mode)
            \\  --outdir DIR      Output directory for --project mode
            \\  --no-comments     Strip comments from output
            \\  --isolated-declarations  Skip initializer parsing when type annotations exist
            \\
            \\If no input file is specified, reads from stdin.
            \\
        );
        return;
    }

    // Project mode: process entire directory
    if (project_dir) |dir| {
        const outdir = out_dir orelse {
            writeErr("error: --project requires --outdir\n");
            return;
        };
        try processProject(alloc, dir, outdir, keep_comments);
        return;
    }

    // Single-file mode
    const source = if (input_file) |path|
        try readFile(alloc, path)
    else
        try readStdin(alloc);
    defer alloc.free(source);

    var arena = std.heap.ArenaAllocator.init(alloc);
    defer arena.deinit();
    const arena_alloc = arena.allocator();

    var scanner = Scanner.init(arena_alloc, source, keep_comments, isolated_declarations);
    _ = try scanner.scan();

    const default_import_order = [_][]const u8{"bun"};
    const dts_output = try emitter.processDeclarations(
        arena_alloc,
        scanner.declarations.items,
        source,
        keep_comments,
        &default_import_order,
    );

    if (output_file) |path| {
        try writeFile(alloc, path, dts_output);
    } else {
        writeAll(dts_output);
        writeAll("\n");
    }
}
