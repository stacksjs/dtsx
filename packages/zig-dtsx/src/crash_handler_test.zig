//! A real fault must reach the CLI's reporter through Zig's installed handler.
const std = @import("std");
const platform = @import("platform.zig");
const c = std.c;

pub const debug = platform.Debug;

pub fn main() !void {
    var descriptors: [2]c.fd_t = undefined;
    if (c.pipe(&descriptors) != 0) return error.PipeFailed;
    defer _ = c.close(descriptors[0]);
    var write_open = true;
    defer if (write_open) {
        _ = c.close(descriptors[1]);
    };
    const child = c.fork();
    if (child < 0) return error.ForkFailed;
    if (child == 0) {
        _ = c.close(descriptors[0]);
        if (c.dup2(descriptors[1], 2) < 0) c._exit(100);
        _ = c.close(descriptors[1]);
        // Volatile prevents optimization from replacing this actual memory
        // fault with an explicit panic, which would test the wrong handler.
        const invalid: *volatile u8 = @ptrFromInt(1);
        _ = invalid.*;
        c._exit(101);
    }
    _ = c.close(descriptors[1]);
    write_open = false;
    var status: c_int = 0;
    var reaped = false;
    defer if (!reaped) {
        while (c.waitpid(child, &status, 0) < 0) {
            if (c.errno(-1) != .INTR) break;
        }
    };
    var output: [512]u8 = undefined;
    var length: usize = 0;
    while (length < output.len) {
        const received = c.read(descriptors[0], output[length..].ptr, output.len - length);
        if (received < 0) {
            if (c.errno(received) == .INTR) continue;
            return error.ReadFailed;
        }
        if (received == 0) break;
        length += @intCast(received);
    }
    while (c.waitpid(child, &status, 0) < 0) {
        if (c.errno(-1) != .INTR) return error.WaitFailed;
    }
    reaped = true;
    const bits: u32 = @bitCast(status);
    try std.testing.expect(c.W.IFSIGNALED(bits));
    try std.testing.expectEqual(c.SIG.ABRT, c.W.TERMSIG(bits));
    const message = output[0..length];
    try std.testing.expect(std.mem.indexOf(u8, message, "Segmentation fault") != null or std.mem.indexOf(u8, message, "Bus error") != null);
    try std.testing.expect(std.mem.indexOf(u8, message, " at address 0x1\n") != null);
    try std.testing.expect(std.mem.indexOf(u8, message, "instruction=0x") != null);
    try std.testing.expect(std.mem.indexOf(u8, message, " frame=0x") != null);
}
