//! Threads and file-system calls for the CLI and the batch library.
//!
//! Zig's `std.Io` and `std.Thread` reach the system through one table of
//! every I/O operation, so using any of them imports about a hundred libc
//! functions (sockets, process spawning, ...). On Darwin, dyld binds every
//! import at launch whether or not it is called, which costs about 0.4 ms per
//! process: more than a tenth of a single-file run. There these few
//! operations call libc directly; other systems keep the standard library.
const std = @import("std");
const builtin = @import("builtin");
const c = std.c;

/// Whether this target talks to libc directly instead of through `std.Io`.
pub const direct_libc = builtin.os.tag.isDarwin();

extern "c" fn sysconf(name: c_int) c_long;
extern "c" fn realpath(noalias path: [*:0]const u8, noalias resolved: ?[*]u8) ?[*:0]u8;

/// Stack given to each worker, the standard library's own default: inference
/// recurses through nested expressions, and libc's 512 KiB default is small.
const worker_stack_size = 16 * 1024 * 1024;

/// `_SC_NPROCESSORS_ONLN` from Darwin's <unistd.h>.
const darwin_sc_nprocessors_onln: c_int = 58;

/// Processors available for worker threads.
pub fn cpuCount() usize {
    if (!direct_libc) return std.Thread.getCpuCount() catch 4;
    const online = sysconf(darwin_sc_nprocessors_onln);
    return if (online > 0) @intCast(online) else 4;
}

/// Run `worker` once per context, each on its own thread, and wait for all of
/// them. One context, or a thread that cannot start, runs on the caller.
pub fn runOnThreads(comptime Ctx: type, comptime worker: fn (Ctx) void, alloc: std.mem.Allocator, contexts: []const Ctx) !void {
    if (contexts.len <= 1) {
        for (contexts) |ctx| worker(ctx);
        return;
    }
    if (!direct_libc) {
        const threads = try alloc.alloc(?std.Thread, contexts.len);
        defer alloc.free(threads);
        for (contexts, threads) |ctx, *thread| {
            thread.* = std.Thread.spawn(.{}, worker, .{ctx}) catch blk: {
                worker(ctx);
                break :blk null;
            };
        }
        for (threads) |thread| {
            if (thread) |started| started.join();
        }
        return;
    }

    const entry = struct {
        fn run(argument: ?*anyopaque) callconv(.c) ?*anyopaque {
            const ctx: *const Ctx = @ptrCast(@alignCast(argument.?));
            worker(ctx.*);
            return null;
        }
    }.run;
    const threads = try alloc.alloc(?c.pthread_t, contexts.len);
    defer alloc.free(threads);
    var attributes: c.pthread_attr_t = undefined;
    const sized = c.pthread_attr_init(&attributes) == .SUCCESS;
    defer if (sized) {
        _ = c.pthread_attr_destroy(&attributes);
    };
    if (sized) _ = c.pthread_attr_setstacksize(&attributes, worker_stack_size);
    for (contexts, threads) |*ctx, *thread| {
        var handle: c.pthread_t = undefined;
        if (c.pthread_create(&handle, if (sized) &attributes else null, entry, @ptrCast(@constCast(ctx))) == .SUCCESS) {
            thread.* = handle;
        } else {
            thread.* = null;
            worker(ctx.*);
        }
    }
    for (threads) |thread| {
        if (thread) |started| _ = c.pthread_join(started, null);
    }
}

/// The canonical absolute path of an existing file or directory.
pub fn realPath(alloc: std.mem.Allocator, path: []const u8) ![]u8 {
    if (!direct_libc) return std.Io.Dir.cwd().realPathFileAlloc(std.Io.Threaded.global_single_threaded.io(), path, alloc);
    const path_z = try alloc.dupeSentinel(u8, path, 0);
    defer alloc.free(path_z);
    const resolved = realpath(path_z.ptr, null) orelse return error.FileNotFound;
    defer c.free(resolved);
    return alloc.dupe(u8, std.mem.span(resolved));
}

fn isDirectory(path_z: [*:0]const u8) bool {
    var info: c.Stat = undefined;
    return c.fstatat(c.AT.FDCWD, path_z, &info, 0) == 0 and (info.mode & c.S.IFMT) == c.S.IFDIR;
}

/// Create the directory `path` and any missing parents. A path that exists
/// and is not a directory is an error.
pub fn makePath(alloc: std.mem.Allocator, path: []const u8) !void {
    if (!direct_libc) {
        const io = std.Io.Threaded.global_single_threaded.io();
        var directory = try std.Io.Dir.cwd().createDirPathOpen(io, path, .{});
        directory.close(io);
        return;
    }
    if (path.len == 0) return;
    const path_z = try alloc.dupeSentinel(u8, path, 0);
    defer alloc.free(path_z);
    // Most builds write into a directory that is already there.
    if (isDirectory(path_z.ptr)) return;
    var end: usize = 1;
    while (end <= path.len) : (end += 1) {
        if (end != path.len and path[end] != '/') continue;
        // Skip the empty component of `a//b` and of a trailing slash.
        if (path[end - 1] == '/') continue;
        path_z[end] = 0;
        const created = c.mkdir(path_z.ptr, 0o777);
        const exists = created != 0 and c.errno(created) == .EXIST;
        if (created != 0 and !exists) return error.CannotCreateDirectory;
        if (exists and !isDirectory(path_z.ptr)) return error.NotDir;
        if (end != path.len) path_z[end] = '/';
    }
}

/// What a directory entry is, following no symbolic link.
pub const EntryKind = enum { directory, sym_link, other };

/// One entry of a directory listing; `name` is valid until the next entry.
pub const Entry = struct { name: []const u8, kind: EntryKind };

/// Entries of one directory, without `.` and `..`. Darwin only.
pub const Listing = struct {
    handle: *c.DIR,
    path_z: [:0]const u8,

    pub fn open(path_z: [:0]const u8) !Listing {
        return .{ .handle = c.opendir(path_z.ptr) orelse return error.DirNotFound, .path_z = path_z };
    }

    pub fn close(self: *Listing) void {
        _ = c.closedir(self.handle);
    }

    pub fn next(self: *Listing, alloc: std.mem.Allocator) !?Entry {
        while (true) {
            c._errno().* = 0;
            const entry = c.readdir(self.handle) orelse {
                if (c._errno().* != 0) return error.DirectoryReadFailure;
                return null;
            };
            const name = entry.name[0..entry.namlen];
            if (std.mem.eql(u8, name, ".") or std.mem.eql(u8, name, "..")) continue;
            const kind: EntryKind = switch (entry.type) {
                c.DT.DIR => .directory,
                c.DT.LNK => .sym_link,
                c.DT.UNKNOWN => try self.statKind(alloc, name),
                else => .other,
            };
            return .{ .name = name, .kind = kind };
        }
    }

    /// Some file systems do not report an entry's type while listing.
    fn statKind(self: *Listing, alloc: std.mem.Allocator, name: []const u8) !EntryKind {
        const child = try std.fmt.allocPrintSentinel(alloc, "{s}/{s}", .{ self.path_z, name }, 0);
        defer alloc.free(child);
        var info: c.Stat = undefined;
        if (c.fstatat(c.AT.FDCWD, child.ptr, &info, c.AT.SYMLINK_NOFOLLOW) != 0) return error.DirectoryReadFailure;
        return switch (info.mode & c.S.IFMT) {
            c.S.IFDIR => .directory,
            c.S.IFLNK => .sym_link,
            else => .other,
        };
    }
};

/// Whether `path_z`, followed through symbolic links, is a directory.
pub fn resolvesToDirectory(path_z: [*:0]const u8) bool {
    return isDirectory(path_z);
}
