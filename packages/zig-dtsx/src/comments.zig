const std = @import("std");

/// Preserve embedded data without allowing it to terminate generated JSDoc.
pub fn escapeJsdocContent(allocator: std.mem.Allocator, value: []const u8) std.mem.Allocator.Error![]const u8 {
    if (std.mem.indexOf(u8, value, "*/") == null) return value;
    return std.mem.replaceOwned(u8, allocator, value, "*/", "*\\/");
}
