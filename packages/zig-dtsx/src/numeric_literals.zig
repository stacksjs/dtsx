//! Numeric literal grammar shared by type recognition and value inference.
const std = @import("std");

fn isDigitForBase(c: u8, base: u8) bool {
    return switch (base) {
        2 => c == '0' or c == '1',
        8 => c >= '0' and c <= '7',
        10 => c >= '0' and c <= '9',
        16 => (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f') or (c >= 'A' and c <= 'F'),
        else => false,
    };
}

fn consumeDigits(s: []const u8, cursor: *usize, base: u8) bool {
    var saw_digit = false;
    var previous_separator = false;
    while (cursor.* < s.len) {
        const c = s[cursor.*];
        if (isDigitForBase(c, base)) {
            saw_digit = true;
            previous_separator = false;
            cursor.* += 1;
        } else if (c == '_' and saw_digit and !previous_separator and cursor.* + 1 < s.len and isDigitForBase(s[cursor.* + 1], base)) {
            previous_separator = true;
            cursor.* += 1;
        } else break;
    }
    return saw_digit and !previous_separator;
}

/// Check decimal, scientific, hexadecimal, binary, and octal numeric literals.
pub fn isNumericLiteral(s: []const u8) bool {
    if (s.len == 0) return false;
    var i: usize = 0;
    if (s[i] == '-') i += 1;
    if (i >= s.len) return false;
    if (i + 2 <= s.len and s[i] == '0' and i + 1 < s.len) {
        const base: ?u8 = switch (s[i + 1]) {
            'x', 'X' => 16,
            'b', 'B' => 2,
            'o', 'O' => 8,
            else => null,
        };
        if (base) |b| {
            i += 2;
            return consumeDigits(s, &i, b) and i == s.len;
        }
    }
    const has_integer_digits = consumeDigits(s, &i, 10);
    if (i < s.len and s[i] == '.') {
        i += 1;
        const has_fraction_digits = consumeDigits(s, &i, 10);
        if (!has_integer_digits and !has_fraction_digits) return false;
    } else if (!has_integer_digits) {
        return false;
    }
    if (i < s.len and (s[i] == 'e' or s[i] == 'E')) {
        i += 1;
        if (i < s.len and (s[i] == '+' or s[i] == '-')) i += 1;
        if (!consumeDigits(s, &i, 10)) return false;
    }
    return i == s.len;
}

/// A numeric or BigInt literal as a literal type: separators do not belong to
/// its value (`5_000` is `5000`). Mirrors the TypeScript emitter.
pub fn numericLiteralType(alloc: std.mem.Allocator, literal: []const u8) std.mem.Allocator.Error![]const u8 {
    if (std.mem.indexOfScalar(u8, literal, '_') == null) return literal;
    var out = try std.array_list.Managed(u8).initCapacity(alloc, literal.len);
    for (literal) |c| if (c != '_') out.appendAssumeCapacity(c);
    return out.toOwnedSlice();
}

/// Check decimal, hexadecimal, binary, and octal BigInt literals, including a
/// leading minus and numeric separators.
pub fn isBigIntLiteral(s: []const u8) bool {
    if (s.len < 2) return false;
    if (s[s.len - 1] != 'n') return false;
    const digits = s[0 .. s.len - 1];
    var i: usize = 0;
    if (digits[i] == '-') i += 1;
    if (i >= digits.len) return false;
    if (i + 1 < digits.len and digits[i] == '0') {
        const base: ?u8 = switch (digits[i + 1]) {
            'x', 'X' => 16,
            'b', 'B' => 2,
            'o', 'O' => 8,
            else => null,
        };
        if (base) |b| {
            i += 2;
            return consumeDigits(digits, &i, b) and i == digits.len;
        }
    }
    return consumeDigits(digits, &i, 10) and i == digits.len;
}
