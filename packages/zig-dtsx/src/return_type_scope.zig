const std = @import("std");
const scanner = @import("scanner.zig");
const syntax = @import("module_specifiers.zig");
const emitter = @import("emitter.zig");
const Declaration = @import("types.zig").Declaration;
const Error = std.mem.Allocator.Error || error{InvalidContext};
const Result = struct { type: []const u8, name: []const u8, block: usize = 0 };
const Block = struct { start: usize, end: usize, header: usize, name: []const u8, parent: usize };
const Pair = struct { open: usize, close: usize, header: usize };
const Rendered = struct { declarations: []const Declaration, text: []const u8, exports: []const Result };

pub const Scope = struct {
    root: ?*scanner.Scanner,
    body: []const u8,
    generics: []const u8 = "",
    helper: ?[]const u8 = null,
    results: std.array_list.Managed(Result),
    blocks: std.array_list.Managed(Block),

    pub fn init(allocator: std.mem.Allocator, root: ?*scanner.Scanner, body: []const u8, generics: []const u8) Scope {
        return .{ .root = root, .body = body, .generics = generics, .results = .init(allocator), .blocks = .init(allocator) };
    }
    pub fn deinit(self: *Scope) void {
        self.results.deinit();
        self.blocks.deinit();
    }

    pub fn resolve(self: *Scope, asserted: []const u8) Error!?[]const u8 {
        const root = self.root orelse return null;
        const alloc = root.allocator;
        if (self.helper == null) {
            while (true) {
                const name = try std.fmt.allocPrint(alloc, "__dtsx_return_{d}", .{root.class_helper_counter});
                root.class_helper_counter += 1;
                if (std.mem.indexOf(u8, root.source, name) == null) {
                    self.helper = name;
                    break;
                }
            }
            try self.blocks.append(.{ .start = 0, .end = self.body.len, .header = 0, .name = "", .parent = 0 });
        }
        const offset = @intFromPtr(asserted.ptr) - @intFromPtr(self.body.ptr);
        var pairs = std.array_list.Managed(Pair).init(alloc);
        defer pairs.deinit();
        const tokens = try syntax.tokenizeDeclarationSyntax(alloc, self.body);
        defer alloc.free(tokens);
        var braces = std.array_list.Managed(usize).init(alloc);
        defer braces.deinit();
        var parens = std.array_list.Managed(usize).init(alloc);
        defer parens.deinit();
        var closing = std.AutoHashMap(usize, usize).init(alloc);
        defer closing.deinit();
        for (tokens, 0..) |token, index| {
            if (token.kind != .punctuation) continue;
            const word = self.body[token.start..token.end];
            if (std.mem.eql(u8, word, "(")) {
                try parens.append(index);
            } else if (std.mem.eql(u8, word, ")")) {
                if (parens.pop()) |open| try closing.put(index, open);
            } else if (std.mem.eql(u8, word, "{")) {
                try braces.append(index);
            } else if (std.mem.eql(u8, word, "}")) {
                const open = braces.pop() orelse continue;
                if (tokens[open].start >= offset or offset >= token.start) continue;
                var header = tokens[open].start;
                if (open > 0) {
                    const before = self.body[tokens[open - 1].start..tokens[open - 1].end];
                    if (std.mem.eql(u8, before, ")")) {
                        if (closing.get(open - 1)) |paren| {
                            if (paren > 0 and isControl(self.body[tokens[paren - 1].start..tokens[paren - 1].end])) header = tokens[paren - 1].start;
                        }
                    } else if (isBlockKeyword(before)) {
                        header = tokens[open - 1].start;
                    }
                }
                try pairs.append(.{ .open = tokens[open].start, .close = token.start, .header = header });
            }
        }
        // Containing pairs close from the inside out.
        var block: usize = 0;
        var index = pairs.items.len;
        while (index > 0) {
            index -= 1;
            const pair = pairs.items[index];
            var child: ?usize = null;
            for (self.blocks.items, 0..) |existing, child_index| {
                if (existing.parent == block and existing.start == pair.open + 1) {
                    child = child_index;
                    break;
                }
            }
            if (child == null) {
                child = self.blocks.items.len;
                const name = try std.fmt.allocPrint(alloc, "{s}_scope_{d}", .{ self.helper.?, child.? - 1 });
                try self.blocks.append(.{ .start = pair.open + 1, .end = pair.close, .header = pair.header, .name = name, .parent = block });
            }
            block = child.?;
        }
        for (self.results.items) |result| if (result.block == block and std.mem.eql(u8, result.type, asserted)) {
            return try std.fmt.allocPrint(alloc, "{s}.{s}", .{ self.helper.?, result.name });
        };
        const name = try std.fmt.allocPrint(alloc, "{s}_result_{d}", .{ self.helper.?, self.results.items.len });
        try self.results.append(.{ .type = asserted, .name = name, .block = block });
        return try std.fmt.allocPrint(alloc, "{s}.{s}", .{ self.helper.?, name });
    }

    fn render(self: *Scope, block_index: usize, inherited: []const []const u8) Error!Rendered {
        const alloc = self.root.?.allocator;
        const block = self.blocks.items[block_index];
        var local_names = std.array_list.Managed([]const u8).init(alloc);
        defer local_names.deinit();
        try local_names.appendSlice(inherited);
        const block_text = self.body[block.start..block.end];
        const block_tokens = try syntax.tokenizeDeclarationSyntax(alloc, block_text);
        defer alloc.free(block_tokens);
        var block_depth: i32 = 0;
        for (block_tokens, 0..) |token, index| {
            const word = block_text[token.start..token.end];
            if (std.mem.eql(u8, word, "{")) {
                block_depth += 1;
            } else if (std.mem.eql(u8, word, "}")) {
                block_depth -= 1;
            } else if (block_depth == 0 and (std.mem.eql(u8, word, "type") or std.mem.eql(u8, word, "interface")) and index + 1 < block_tokens.len) {
                try local_names.append(block_text[block_tokens[index + 1].start..block_tokens[index + 1].end]);
            }
        }
        var source = std.array_list.Managed(u8).init(alloc);
        var exports = std.array_list.Managed(Result).init(alloc);
        for (self.results.items) |result| if (result.block == block_index) {
            try exports.append(result);
        };
        var cursor = block.start;
        // Block creation follows return traversal, hence source order.
        for (self.blocks.items, 0..) |child, index| {
            if (index == 0 or child.parent != block_index) continue;
            const nested = try self.render(index, local_names.items);
            try source.appendSlice(self.body[cursor..child.header]);
            try source.appendSlice(try std.fmt.allocPrint(alloc, "\ndeclare namespace {s} {{\n{s}\n}}\n", .{ child.name, nested.text }));
            cursor = child.end + 1;
            for (nested.exports) |result| try exports.append(.{ .type = try std.fmt.allocPrint(alloc, "{s}.{s}", .{ child.name, result.name }), .name = result.name });
        }
        try source.appendSlice(self.body[cursor..block.end]);
        try source.appendSlice("\n;\n");
        for (exports.items) |result| try source.appendSlice(try std.fmt.allocPrint(alloc, "export type {s} = {s};\n", .{ result.name, result.type }));
        var nested = scanner.Scanner.init(alloc, try source.toOwnedSlice(), false, false);
        defer nested.deinit();
        const parsed = nested.scan() catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.InvalidContext;
        var output = std.array_list.Managed(u8).init(alloc);
        for (exports.items) |result| try local_names.append(result.name);
        for (parsed.declarations.items) |declaration| {
            if (self.generics.len > 0 and (declaration.kind == .type_decl or declaration.kind == .interface_decl)) {
                try output.appendSlice(try liftCapturedDeclaration(alloc, declaration, self.generics, self.helper.?, local_names.items));
                try output.append('\n');
                continue;
            }
            var text = if (declaration.kind == .variable_decl) emitter.processVariableDeclaration(alloc, declaration, false) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.InvalidContext else declaration.text;
            const tokens = try syntax.tokenizeDeclarationSyntax(alloc, text);
            defer alloc.free(tokens);
            var first: usize = 0;
            while (first < tokens.len) : (first += 1) {
                const word = text[tokens[first].start..tokens[first].end];
                if (!std.mem.eql(u8, word, "export") and !std.mem.eql(u8, word, "declare")) break;
            }
            if (first > 0 and first < tokens.len) {
                try output.appendSlice(text[0..tokens[0].start]);
                text = text[tokens[first].start..];
            }
            try output.appendSlice(text);
            try output.append('\n');
        }
        return .{ .declarations = try alloc.dupe(Declaration, parsed.declarations.items), .text = try output.toOwnedSlice(), .exports = try exports.toOwnedSlice() };
    }

    pub fn finish(self: *Scope, signature: []const u8) Error![]const u8 {
        const helper = self.helper orelse return signature;
        const root = self.root.?;
        const alloc = root.allocator;
        const rendered = try self.render(0, &.{});
        var only_results = true;
        for (rendered.declarations) |declaration| {
            var found = false;
            for (self.results.items) |result| if (std.mem.eql(u8, result.name, declaration.name)) {
                found = true;
                break;
            };
            if (!found) {
                only_results = false;
            }
        }
        var replacements = std.array_list.Managed([]const u8).init(alloc);
        defer replacements.deinit();
        if (only_results) {
            for (self.results.items) |result| try replacements.append(try std.fmt.allocPrint(alloc, "({s})", .{result.type}));
        } else {
            root.non_exported_types_inited = true;
            try root.non_exported_types.put(helper, .{ .kind = .module_decl, .name = helper, .text = try std.fmt.allocPrint(alloc, "declare namespace {s} {{\n{s}\n}}", .{ helper, rendered.text }), .module_form = .namespace, .start = root.pos, .end = root.pos });
            if (self.generics.len == 0) return signature;
            const parameters = try genericNames(alloc, self.generics);
            for (self.results.items) |result| try replacements.append(try std.fmt.allocPrint(alloc, "{s}.{s}<{s}>", .{ helper, result.name, parameters }));
        }
        const tokens = try syntax.tokenizeDeclarationSyntax(alloc, signature);
        defer alloc.free(tokens);
        var output = std.array_list.Managed(u8).init(alloc);
        var cursor: usize = 0;
        var index: usize = 0;
        while (index + 2 < tokens.len) : (index += 1) {
            if (!std.mem.eql(u8, signature[tokens[index].start..tokens[index].end], helper) or !std.mem.eql(u8, signature[tokens[index + 1].start..tokens[index + 1].end], ".")) continue;
            for (self.results.items, 0..) |result, result_index| if (std.mem.eql(u8, signature[tokens[index + 2].start..tokens[index + 2].end], result.name)) {
                try output.appendSlice(signature[cursor..tokens[index].start]);
                try output.appendSlice(replacements.items[result_index]);
                cursor = tokens[index + 2].end;
                index += 2;
                break;
            };
        }
        try output.appendSlice(signature[cursor..]);
        return try output.toOwnedSlice();
    }
};

const Capture = struct { original: []const u8, renamed: []const u8 };
fn hasName(names: []const []const u8, word: []const u8) bool {
    for (names) |name| if (std.mem.eql(u8, word, name)) return true;
    return false;
}
fn rewriteCaptured(alloc: std.mem.Allocator, text: []const u8, captures: []const Capture, locals: []const []const u8, shadow: []const []const u8, strip_const: bool) Error![]const u8 {
    const tokens = try syntax.tokenizeDeclarationSyntax(alloc, text);
    defer alloc.free(tokens);
    var output = std.array_list.Managed(u8).init(alloc);
    var cursor: usize = 0;
    var index: usize = 0;
    while (index < tokens.len) : (index += 1) {
        const token = tokens[index];
        if (token.kind != .word) continue;
        const word = text[token.start..token.end];
        const next = if (index + 1 < tokens.len) text[tokens[index + 1].start..tokens[index + 1].end] else "";
        const after = if (index + 2 < tokens.len) text[tokens[index + 2].start..tokens[index + 2].end] else "";
        const previous = if (index > 0) text[tokens[index - 1].start..tokens[index - 1].end] else "";
        if (std.mem.eql(u8, next, ":") or (std.mem.eql(u8, next, "?") and std.mem.eql(u8, after, ":"))) continue;
        if (strip_const and std.mem.eql(u8, word, "const")) {
            try output.appendSlice(text[cursor..token.start]);
            cursor = token.end;
            continue;
        }
        if (hasName(shadow, word)) continue;
        var replacement: ?[]const u8 = null;
        if (!std.mem.eql(u8, previous, ".")) {
            for (captures) |capture| if (std.mem.eql(u8, capture.original, word)) {
                replacement = capture.renamed;
                break;
            };
        }
        if (replacement) |renamed| {
            try output.appendSlice(text[cursor..token.start]);
            try output.appendSlice(renamed);
            cursor = token.end;
        } else if (hasName(locals, word)) {
            try output.appendSlice(text[cursor..token.end]);
            try output.append('<');
            for (captures, 0..) |capture, capture_index| {
                if (capture_index > 0) try output.appendSlice(", ");
                try output.appendSlice(capture.renamed);
            }
            if (std.mem.eql(u8, next, "<")) {
                try output.appendSlice(", ");
                index += 1;
                cursor = tokens[index].end;
            } else {
                try output.append('>');
                cursor = token.end;
            }
        }
    }
    try output.appendSlice(text[cursor..]);
    return try output.toOwnedSlice();
}

/// Local aliases retain their own binders, while every enclosing parameter is
/// captured explicitly on the lifted declarations and their recursive uses.
fn liftCapturedDeclaration(alloc: std.mem.Allocator, declaration: Declaration, generics: []const u8, helper: []const u8, locals: []const []const u8) Error![]const u8 {
    var captures = std.array_list.Managed(Capture).init(alloc);
    defer captures.deinit();
    const parameters = try genericNames(alloc, generics);
    var parameter_iter = std.mem.tokenizeAny(u8, parameters, ", ");
    while (parameter_iter.next()) |name| try captures.append(.{ .original = name, .renamed = try std.fmt.allocPrint(alloc, "{s}_capture_{d}", .{ helper, captures.items.len }) });
    var own = std.array_list.Managed([]const u8).init(alloc);
    defer own.deinit();
    if (declaration.generics.len > 0) {
        const names = try genericNames(alloc, declaration.generics);
        var own_iter = std.mem.tokenizeAny(u8, names, ", ");
        while (own_iter.next()) |name| try own.append(name);
    }
    const tokens = try syntax.tokenizeDeclarationSyntax(alloc, declaration.text);
    defer alloc.free(tokens);
    var binding_end: ?usize = null;
    for (tokens, 0..) |token, index| {
        const word = declaration.text[token.start..token.end];
        if ((std.mem.eql(u8, word, "type") or std.mem.eql(u8, word, "interface")) and index + 1 < tokens.len) {
            binding_end = tokens[index + 1].end;
            break;
        }
    }
    const end = binding_end orelse return error.InvalidContext;
    const original = declaration.generics;
    const header_end = if (original.len > 0) (std.mem.indexOfPos(u8, declaration.text, end, original) orelse return error.InvalidContext) + original.len else end;
    const capture_header = try rewriteCaptured(alloc, try captureParameters(alloc, generics), captures.items, &.{}, &.{}, false);
    var output = std.array_list.Managed(u8).init(alloc);
    const prefix = declaration.text[0..end];
    const prefix_start = if (std.mem.startsWith(u8, prefix, "export ")) @as(usize, 7) else 0;
    const declare_start = if (std.mem.startsWith(u8, prefix[prefix_start..], "declare ")) prefix_start + 8 else prefix_start;
    try output.appendSlice(prefix[declare_start..]);
    try output.append('<');
    try output.appendSlice(capture_header);
    if (original.len > 0) {
        try output.appendSlice(", ");
        try output.appendSlice(try rewriteCaptured(alloc, original[1 .. original.len - 1], captures.items, locals, own.items, false));
    }
    try output.append('>');
    try output.appendSlice(try rewriteCaptured(alloc, declaration.text[header_end..], captures.items, locals, own.items, false));
    return try output.toOwnedSlice();
}

fn isControl(word: []const u8) bool {
    for ([_][]const u8{ "if", "for", "while", "switch", "catch", "with" }) |keyword| if (std.mem.eql(u8, word, keyword)) return true;
    return false;
}
fn isBlockKeyword(word: []const u8) bool {
    for ([_][]const u8{ "else", "try", "finally", "do" }) |keyword| if (std.mem.eql(u8, word, keyword)) return true;
    return false;
}
fn genericNames(alloc: std.mem.Allocator, generics: []const u8) Error![]const u8 {
    const tokens = try syntax.tokenizeDeclarationSyntax(alloc, generics);
    defer alloc.free(tokens);
    var output = std.array_list.Managed(u8).init(alloc);
    var depth: i32 = 0;
    var structural: i32 = 0;
    var expected = false;
    for (tokens) |token| {
        const text = generics[token.start..token.end];
        if (std.mem.eql(u8, text, "<")) {
            depth += 1;
            if (depth == 1) expected = true;
        } else if (std.mem.eql(u8, text, ">") and (token.start == 0 or generics[token.start - 1] != '=')) {
            depth -= 1;
        } else if (std.mem.indexOf(u8, "([{", text) != null) {
            structural += 1;
        } else if (std.mem.indexOf(u8, ")]}", text) != null) {
            structural -= 1;
        } else if (std.mem.eql(u8, text, ",") and depth == 1 and structural == 0) {
            expected = true;
        } else if (expected and token.kind == .word and !std.mem.eql(u8, text, "const") and !std.mem.eql(u8, text, "in") and !std.mem.eql(u8, text, "out")) {
            if (output.items.len > 0) try output.appendSlice(", ");
            try output.appendSlice(text);
            expected = false;
        }
    }
    return try output.toOwnedSlice();
}

pub fn assertion(allocator: std.mem.Allocator, value: []const u8) Error!?[]const u8 {
    if (std.mem.indexOf(u8, value, "as") == null) return null;
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, value);
    defer allocator.free(tokens);
    var depth: i32 = 0;
    var selected: ?usize = null;
    for (tokens, 0..) |token, index| {
        const text = value[token.start..token.end];
        if (token.kind == .punctuation) {
            if (std.mem.indexOf(u8, "([{", text) != null) depth += 1 else if (std.mem.indexOf(u8, ")]}", text) != null) depth -= 1;
        } else if (depth == 0 and token.kind == .word and std.mem.eql(u8, text, "as") and index > 0 and !std.mem.eql(u8, value[tokens[index - 1].start..tokens[index - 1].end], ".")) selected = index;
    }
    const index = selected orelse return null;
    if (index + 1 == tokens.len) return null;
    const result = std.mem.trim(u8, value[tokens[index].end..], " \t\r\n");
    if (std.mem.eql(u8, result, "const")) return null;
    depth = 0;
    for (tokens[index + 1 ..]) |token| {
        if (token.kind != .punctuation) continue;
        const text = value[token.start..token.end];
        if (depth == 0 and (std.mem.startsWith(u8, value[token.start..], "??") or std.mem.startsWith(u8, value[token.start..], "||") or std.mem.startsWith(u8, value[token.start..], "&&"))) return null;
        if (std.mem.indexOf(u8, "([{<", text) != null) depth += 1 else if (std.mem.indexOf(u8, ")]}>", text) != null) depth -= 1 else if (depth == 0 and std.mem.indexOf(u8, "+-*/%=!;", text) != null) return null;
    }
    return result;
}

fn checkAllocations(backing: std.mem.Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(backing);
    defer arena.deinit();
    const allocator = arena.allocator();
    const source = "export function read() { const local = { value: 7 }; type Private = typeof local; return local as Private; }";
    var root = scanner.Scanner.init(allocator, source, true, false);
    defer root.deinit();
    const parsed = try root.scan();
    var scoped = false;
    for (parsed.declarations.items) |declaration| {
        if (std.mem.indexOf(u8, declaration.text, "declare namespace __dtsx_return_") != null) {
            scoped = true;
            try std.testing.expect(std.mem.indexOf(u8, declaration.text, "type Private = typeof local") != null);
            try std.testing.expect(std.mem.indexOf(u8, declaration.text, "declare const local") == null);
        }
    }
    try std.testing.expect(scoped);
}

test "local return scopes retain dependencies and propagate backing allocation failures" {
    try checkAllocations(std.testing.allocator);
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkAllocations, .{});
}

fn checkScopedAllocations(backing: std.mem.Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(backing);
    defer arena.deinit();
    const allocator = arena.allocator();
    const source = "export function read<T>(value: T) { type Private = Later; interface Later { value: T } return { value } as Private; } export function block(flag: boolean) { if (flag) { type Private = { value: number }; return { value: 7 } as Private; } else { type Private = { value: string }; return { value: \"ready\" } as Private; } }";
    var root = scanner.Scanner.init(allocator, source, false, false);
    defer root.deinit();
    const parsed = try root.scan();
    var captured = false;
    var blocked = false;
    for (parsed.declarations.items) |declaration| {
        if (std.mem.indexOf(u8, declaration.text, "interface Later<__dtsx_return_0_capture_0>") != null) captured = true;
        if (std.mem.indexOf(u8, declaration.text, "_scope_1") != null) blocked = true;
    }
    try std.testing.expect(captured);
    try std.testing.expect(blocked);
}

test "captured and block-local return scopes propagate backing allocation failures" {
    try checkScopedAllocations(std.testing.allocator);
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkScopedAllocations, .{});
}

fn captureParameters(alloc: std.mem.Allocator, generics: []const u8) Error![]const u8 {
    const text = generics[1 .. generics.len - 1];
    const tokens = try syntax.tokenizeDeclarationSyntax(alloc, text);
    defer alloc.free(tokens);
    var output = std.array_list.Managed(u8).init(alloc);
    var depth: i32 = 0;
    var cursor: usize = 0;
    var omitted = false;
    for (tokens, 0..) |token, index| {
        if (token.kind != .punctuation and token.kind != .word) continue;
        const word = text[token.start..token.end];
        if (std.mem.indexOf(u8, "([{<", word) != null) {
            depth += 1;
        } else if (std.mem.indexOf(u8, ")]}", word) != null or (std.mem.eql(u8, word, ">") and (token.start == 0 or text[token.start - 1] != '='))) {
            depth -= 1;
        } else if (depth == 0 and std.mem.eql(u8, word, "const")) {
            try output.appendSlice(text[cursor..token.start]);
            cursor = token.end;
        } else if (depth == 0 and std.mem.eql(u8, word, "=") and !(index + 1 < tokens.len and std.mem.eql(u8, text[tokens[index + 1].start..tokens[index + 1].end], ">"))) {
            try output.appendSlice(text[cursor..token.start]);
            omitted = true;
        } else if (depth == 0 and std.mem.eql(u8, word, ",") and omitted) {
            cursor = token.start;
            omitted = false;
        }
    }
    if (!omitted) try output.appendSlice(text[cursor..]);
    return try output.toOwnedSlice();
}
