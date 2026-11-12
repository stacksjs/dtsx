//! Source-position inference of direct aliases before private declaration closure.
//! This models straight-line assignments, not a complete TypeScript flow graph.
const std = @import("std");
const ch = @import("char_utils.zig");
const syntax = @import("module_specifiers.zig");
const refs = @import("declaration_references.zig");
const type_inf = @import("type_inference.zig");
const Declaration = @import("types.zig").Declaration;
const Binding = struct { declared: ?[]const u8 = null, flow: ?[]const u8 = null, unresolved: bool = false, active: bool = false };
const Value = struct { type: ?[]const u8 = null, unresolved: bool = false };
const Write = struct { binding: *Binding, operator: []const u8 };
const Deferred = struct { start: usize, end: usize };
const LocalCall = struct { type: []const u8, flow: []const u8 };
const MemberKey = struct { next: usize, is_static: bool };

fn oneOf(value: []const u8, choices: []const []const u8) bool {
    for (choices) |choice| if (std.mem.eql(u8, value, choice)) return true;
    return false;
}

fn sameType(allocator: std.mem.Allocator, left: []const u8, right: []const u8) !bool {
    const left_tokens = try syntax.tokenizeDeclarationSyntax(allocator, left);
    defer allocator.free(left_tokens);
    const right_tokens = try syntax.tokenizeDeclarationSyntax(allocator, right);
    defer allocator.free(right_tokens);
    if (left_tokens.len != right_tokens.len) return false;
    for (left_tokens, right_tokens) |a, b| {
        if (!std.mem.eql(u8, left[a.start..a.end], right[b.start..b.end])) return false;
    }
    return true;
}

fn primitive(allocator: std.mem.Allocator, value: []const u8) !?[]const u8 {
    if (oneOf(value, &.{ "number", "string", "boolean", "bigint", "symbol", "undefined", "null" })) return value;
    const inferred = try type_inf.inferNarrowType(allocator, value, false, false, 0);
    return if (oneOf(inferred, &.{ "number", "string", "boolean", "bigint", "undefined", "null" })) inferred else null;
}

fn assignedType(allocator: std.mem.Allocator, declared: []const u8, value: []const u8) !?[]const u8 {
    if (try sameType(allocator, declared, value)) return declared;
    const category = try primitive(allocator, value) orelse return null;
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, declared);
    defer allocator.free(tokens);
    var members = std.array_list.Managed([]const u8).init(allocator);
    defer members.deinit();
    var depth: isize = 0;
    var start: usize = 0;
    for (tokens) |item| {
        const piece = declared[item.start..item.end];
        if (oneOf(piece, &.{ "(", "[", "{", "<" })) depth += 1 else if (oneOf(piece, &.{ ")", "]", "}", ">" })) depth -= 1 else if (depth == 0 and std.mem.eql(u8, piece, "|")) {
            try members.append(std.mem.trim(u8, declared[start..item.start], " \t\r\n"));
            start = item.end;
        }
    }
    try members.append(std.mem.trim(u8, declared[start..], " \t\r\n"));
    for (members.items) |member| if (try sameType(allocator, member, value)) return member;
    for (members.items) |member| {
        if (std.mem.eql(u8, member, category)) {
            return if (std.mem.eql(u8, category, "boolean") and oneOf(value, &.{ "true", "false" })) value else category;
        }
    }
    return null;
}

fn directCall(allocator: std.mem.Allocator, original: []const u8, functions: *const std.StringHashMap(void)) !?[]const u8 {
    const value = std.mem.trim(u8, original, " \t\r\n");
    if (value.len == 0 or !ch.isIdentStart(value[0])) return null;
    var end: usize = 1;
    while (end < value.len and ch.isIdentChar(value[end])) end += 1;
    if (!functions.contains(value[0..end])) return null;
    const items = try syntax.tokenizeDeclarationSyntax(allocator, value);
    defer allocator.free(items);
    if (items.len < 3 or items[0].kind != .word or !std.mem.eql(u8, value[items[1].start..items[1].end], "(")) return null;
    var depth: usize = 1;
    for (items[2..], 2..) |item, index| {
        const piece = value[item.start..item.end];
        if (std.mem.eql(u8, piece, "(")) depth += 1 else if (std.mem.eql(u8, piece, ")")) {
            depth -= 1;
            if (depth == 0) return if (index + 1 == items.len) value[items[0].start..items[0].end] else null;
        }
    }
    return null;
}

pub fn functionReturn(allocator: std.mem.Allocator, text: []const u8) ![]const u8 {
    const items = try syntax.tokenizeDeclarationSyntax(allocator, text);
    defer allocator.free(items);
    var depth: usize = 0;
    for (items, 0..) |item, index| {
        const piece = text[item.start..item.end];
        if (std.mem.eql(u8, piece, "(")) depth += 1 else if (std.mem.eql(u8, piece, ")") and depth > 0) {
            depth -= 1;
            if (depth == 0 and index + 1 < items.len and std.mem.eql(u8, text[items[index + 1].start..items[index + 1].end], ":")) return std.mem.trim(u8, text[items[index + 1].end..], " \t\r\n;");
        }
    }
    return "";
}

const Context = struct {
    allocator: std.mem.Allocator,
    source: []const u8,
    items: []const syntax.SyntaxToken,
    bindings: std.StringHashMap(Binding),
    pairs: std.AutoHashMap(usize, usize),
    parents: std.AutoHashMap(usize, usize),
    object_literals: std.AutoHashMap(usize, void),
    class_bodies: std.AutoHashMap(usize, void),
    class_member_syntax: std.AutoHashMap(usize, void),
    instance_initializers: std.AutoHashMap(usize, usize),
    operators: std.AutoHashMap(usize, []const u8),
    local_calls: std.StringHashMap(LocalCall),
    functions: std.StringHashMap(void),
    inferred_calls: std.AutoHashMap(*Declaration, []const u8),
    cursor: usize = 0,

    fn token(self: *const Context, index: usize) []const u8 {
        return if (index < self.items.len) self.source[self.items[index].start..self.items[index].end] else "";
    }

    fn expressionType(self: *const Context, expression: []const u8) !Value {
        if (try refs.directConstValueAlias(self.allocator, expression)) |alias| {
            const binding = self.bindings.get(alias) orelse return .{};
            return .{ .type = binding.flow, .unresolved = binding.unresolved };
        }
        if (try directCall(self.allocator, expression, &self.functions)) |name| {
            if (self.local_calls.get(name)) |call| return .{ .type = call.flow };
        }
        const inferred = try type_inf.inferNarrowType(self.allocator, expression, true, false, 0);
        return .{ .type = if (std.mem.eql(u8, inferred, "unknown")) null else inferred };
    }

    fn operator(self: *const Context, index: usize) []const u8 {
        return self.operators.get(index) orelse "";
    }

    fn write(self: *Context, index: usize) ?Write {
        if (index >= self.items.len or self.items[index].kind != .word or self.class_member_syntax.contains(index) or
            (index > 0 and std.mem.eql(u8, self.token(index - 1), ".")) or
            (index >= 2 and std.mem.eql(u8, self.token(index - 1), "#") and std.mem.eql(u8, self.token(index - 2), "."))) return null;
        const binding = self.bindings.getPtr(self.token(index)) orelse return null;
        if (!binding.active) return null;
        const next = self.operator(index + 1);
        if (oneOf(next, &.{ "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??=" })) return .{ .binding = binding, .operator = next };
        if (oneOf(next, &.{ "++", "--" }) and std.mem.indexOfAny(u8, self.source[self.items[index].end..self.items[index + 1].start], "\r\n") == null) return .{ .binding = binding, .operator = next };
        if (index >= 2 and oneOf(self.operator(index - 2), &.{ "++", "--" })) {
            const prior_operand = index >= 3 and (self.items[index - 3].kind == .word or self.items[index - 3].kind == .quoted or oneOf(self.token(index - 3), &.{ ")", "]" }));
            if (!prior_operand or std.mem.indexOfAny(u8, self.source[self.items[index - 3].end..self.items[index - 2].start], "\r\n;") != null) return .{ .binding = binding, .operator = self.operator(index - 2) };
        }
        return null;
    }

    fn assignment(self: *Context, index: usize) ?*Binding {
        const target = self.write(index) orelse return null;
        return if (std.mem.eql(u8, target.operator, "=")) target.binding else null;
    }

    fn findClassBody(self: *const Context, index: usize) syntax.SyntaxError!?usize {
        if (index >= self.items.len or self.items[index].kind != .word or !std.mem.eql(u8, self.token(index), "class") or
            (index > 0 and std.mem.eql(u8, self.token(index - 1), ".")) or oneOf(self.token(index + 1), &.{ "(", ":", "=" })) return null;
        var header = index + 1;
        var angles: usize = 0;
        while (header < self.items.len) {
            const piece = self.token(header);
            if (std.mem.eql(u8, piece, "{") and angles == 0) return header;
            if (std.mem.eql(u8, piece, "class")) {
                if (try self.findClassBody(header)) |nested| {
                    header = (self.pairs.get(nested) orelse nested) + 1;
                    continue;
                }
            }
            if (std.mem.eql(u8, piece, "function")) {
                if (try self.deferredBody(header, self.items.len)) |deferred| {
                    header = deferred.end;
                    continue;
                }
            }
            if (std.mem.eql(u8, piece, "<")) angles += 1 else if (std.mem.eql(u8, piece, ">") and !std.mem.eql(u8, self.operator(header -| 1), "=>") and angles > 0) angles -= 1;
            if (std.mem.eql(u8, piece, ";")) break;
            header = (self.pairs.get(header) orelse header) + 1;
        }
        return null;
    }

    fn memberKey(self: *const Context, member: usize, limit: usize, is_class: bool) syntax.SyntaxError!?MemberKey {
        var key = member;
        var is_static = false;
        const modifiers: []const []const u8 = if (is_class)
            &.{ "public", "protected", "private", "static", "abstract", "override", "declare", "readonly", "accessor", "async", "get", "set" }
        else
            &.{ "async", "get", "set" };
        while (oneOf(self.token(key), modifiers) and !oneOf(self.token(key + 1), &.{ "(", "<", "?", "!", ":", "=", ";", "}" })) {
            if (std.mem.eql(u8, self.token(key), "static")) is_static = true;
            key += 1;
        }
        if (std.mem.eql(u8, self.token(key), "*")) key += 1;
        if (is_class and std.mem.eql(u8, self.token(key), "#")) key += 1;
        if (std.mem.eql(u8, self.token(key), "[")) {
            const close = self.pairs.get(key) orelse return null;
            return .{ .next = close + 1, .is_static = is_static };
        }
        if (key < self.items.len and (self.items[key].kind == .word or self.items[key].kind == .quoted)) return .{
            .next = key + 1,
            .is_static = is_static,
        };
        var end = key + 1;
        while (end < limit and self.items[end - 1].end == self.items[end].start and !oneOf(self.token(end), &.{ "(", "<", "?", "!", ":", "=", ";", "}", "[", "{", "," })) end += 1;
        if (key < limit and std.mem.eql(u8, try type_inf.inferNarrowType(self.allocator, self.source[self.items[key].start..self.items[end - 1].end], false, false, 0), "number")) return .{ .next = end, .is_static = is_static };
        return null;
    }

    fn memberHeaderEnd(self: *const Context, member: usize, limit: usize, is_class: bool) syntax.SyntaxError!?usize {
        const parsed = try self.memberKey(member, limit, is_class) orelse return null;
        var key = parsed.next;
        if (is_class and oneOf(self.token(key), &.{ "?", "!" })) key += 1;
        if (std.mem.eql(u8, self.token(key), "<")) {
            var depth: usize = 1;
            key += 1;
            while (key < limit and depth > 0) {
                if (std.mem.eql(u8, self.token(key), "<")) depth += 1 else if (std.mem.eql(u8, self.token(key), ">") and !std.mem.eql(u8, self.operator(key -| 1), "=>")) depth -= 1;
                key = (self.pairs.get(key) orelse key) + 1;
            }
            if (depth != 0) return null;
        }
        return key;
    }

    fn methodHeaderMatches(self: *const Context, member: usize, index: usize, is_class: bool) syntax.SyntaxError!bool {
        const header = try self.memberHeaderEnd(member, index, is_class) orelse return false;
        return header == index;
    }

    fn endsWithTypeArguments(self: *const Context, start: usize, end: usize) bool {
        var depth: usize = 0;
        var opening: ?usize = null;
        var index = start;
        while (index < end) : (index = (self.pairs.get(index) orelse index) + 1) {
            if (std.mem.eql(u8, self.token(index), "<") and (depth > 0 or (index > start and
                (self.items[index - 1].kind == .word or oneOf(self.token(index - 1), &.{ ")", "]" })))))
            {
                if (depth == 0) opening = index;
                depth += 1;
            } else if (std.mem.eql(u8, self.token(index), ">") and !std.mem.eql(u8, self.operator(index -| 1), "=>") and depth > 0) {
                depth -= 1;
                if (index == end - 1 and depth == 0) return opening != null and opening.? < index - 1;
            }
        }
        return false;
    }

    fn beginsClassMember(self: *const Context, index: usize, close: usize) syntax.SyntaxError!bool {
        if (std.mem.eql(u8, self.token(index), "static") and std.mem.eql(u8, self.token(index + 1), "{")) return true;
        const header = try self.memberHeaderEnd(index, close, true) orelse return false;
        return header == close or oneOf(self.token(header), &.{ "(", ":", "=", ";", "}" });
    }

    fn classRangeEnd(self: *const Context, start: usize, container: usize, stop_at_equals: bool) syntax.SyntaxError!usize {
        const close = self.pairs.get(container) orelse self.items.len;
        var index = start;
        while (index < close) {
            if (std.mem.eql(u8, self.token(index), ";") or (stop_at_equals and std.mem.eql(u8, self.operator(index), "="))) return index;
            if (index > start and self.parents.get(index) == container and
                std.mem.indexOfAny(u8, self.source[self.items[index - 1].end..self.items[index].start], "\r\n") != null)
            {
                // A closing type argument can complete an operand before a
                // genuine member header, unlike a dot or unfinished expression.
                const generic_operand = std.mem.eql(u8, self.token(index - 1), ">") and self.endsWithTypeArguments(start, index) and try self.beginsClassMember(index, close);
                const incomplete = !generic_operand and oneOf(self.token(index - 1), &.{ "+", "-", "*", "/", "%", "=", "<", ">", "&", "|", "^", "!", "~", "?", ":", ",", ".", "(", "[", "{", "as", "in", "of", "new", "typeof", "keyof", "extends", "instanceof", "satisfies", "await", "yield", "void" });
                const continuation = oneOf(self.token(index), &.{ ".", "?", ":", ")", "]", "}", ",", "+", "-", "*", "/", "%", "<", ">", "=", "&", "|", "^", "`", "(", "[", "as", "satisfies", "instanceof", "in" });
                if (!incomplete and !continuation) return index;
            }
            index = (self.pairs.get(index) orelse index) + 1;
        }
        return close;
    }

    fn markClassHeader(self: *Context, start: usize, end: usize) std.mem.Allocator.Error!void {
        var index = start;
        while (index < end) : (index += 1) {
            if (std.mem.eql(u8, self.token(index), "[")) {
                if (self.pairs.get(index)) |close| {
                    index = close;
                    continue;
                }
            }
            if (self.items[index].kind == .word) try self.class_member_syntax.put(index, {});
        }
    }

    fn classifyClassMembers(self: *Context, container: usize) syntax.SyntaxError!void {
        const close = self.pairs.get(container) orelse self.items.len;
        var member = container + 1;
        while (member < close) {
            if (std.mem.eql(u8, self.token(member), ";")) {
                member += 1;
                continue;
            }
            if (std.mem.eql(u8, self.token(member), "static") and std.mem.eql(u8, self.token(member + 1), "{")) {
                member = (self.pairs.get(member + 1) orelse (member + 1)) + 1;
                continue;
            }
            const parsed = try self.memberKey(member, close, true) orelse {
                member += 1;
                continue;
            };
            const after_key = try self.memberHeaderEnd(member, close, true) orelse {
                member += 1;
                continue;
            };
            try self.markClassHeader(member, after_key);
            if (std.mem.eql(u8, self.token(after_key), "(")) {
                const parameters = self.pairs.get(after_key);
                const body = if (parameters) |parameter_end| try self.methodBody(parameter_end, close) else null;
                if (body) |body_start| {
                    member = (self.pairs.get(body_start) orelse body_start) + 1;
                    continue;
                }
            }
            var initializer_boundary = after_key;
            if (std.mem.eql(u8, self.token(initializer_boundary), ":")) initializer_boundary = try self.classRangeEnd(initializer_boundary + 1, container, true);
            if (std.mem.eql(u8, self.operator(initializer_boundary), "=")) {
                try self.markClassHeader(member, initializer_boundary + 1);
                const start = initializer_boundary + 1;
                const end = try self.classRangeEnd(start, container, false);
                if (!parsed.is_static and end > start) try self.instance_initializers.put(start, end);
                member = end;
            } else {
                const end = try self.classRangeEnd(after_key, container, false);
                try self.markClassHeader(member, end);
                member = @max(member + 1, end);
            }
        }
    }

    fn isMethodParameters(self: *const Context, index: usize) syntax.SyntaxError!bool {
        const container = self.parents.get(index) orelse return false;
        const is_class = self.class_bodies.contains(container);
        if (!is_class and !self.object_literals.contains(container)) return false;
        if (try self.methodHeaderMatches(container + 1, index, is_class)) return true;
        var previous = container + 1;
        while (previous < index) : (previous += 1) {
            const parent = self.parents.get(previous);
            const separator = parent == container and (std.mem.eql(u8, self.token(previous), ",") or (is_class and std.mem.eql(u8, self.token(previous), ";")));
            const previous_body = is_class and std.mem.eql(u8, self.token(previous), "}") and parent != null and self.parents.get(parent.?) == container;
            const line_boundary = is_class and self.parents.get(previous + 1) == container and
                std.mem.indexOfAny(u8, self.source[self.items[previous].end..self.items[previous + 1].start], "\r\n") != null;
            if ((separator or previous_body or line_boundary) and try self.methodHeaderMatches(previous + 1, index, is_class)) return true;
        }
        return false;
    }

    fn methodBody(self: *const Context, close: usize, limit: usize) syntax.SyntaxError!?usize {
        var body = close + 1;
        const type_start: ?usize = if (std.mem.eql(u8, self.token(body), ":")) body + 1 else null;
        while (body < limit) {
            if (std.mem.eql(u8, self.token(body), "{")) {
                if (type_start == null or !try refs.returnTypeExpectsObject(self.allocator, self.source[self.items[type_start.?].start..self.items[body].start])) return body;
            }
            if (type_start == null) return null;
            body = (self.pairs.get(body) orelse body) + 1;
        }
        return null;
    }

    fn deferredBody(self: *const Context, index: usize, limit: usize) syntax.SyntaxError!?Deferred {
        var body: ?usize = null;
        if (std.mem.eql(u8, self.token(index), "(")) {
            if (self.pairs.get(index)) |close| {
                if (try self.isMethodParameters(index)) body = try self.methodBody(close, limit) else if (std.mem.eql(u8, self.operator(close + 1), "=>")) body = close + 3 else if (std.mem.eql(u8, self.token(close + 1), ":")) {
                    var result = close + 2;
                    while (result < limit and !std.mem.eql(u8, self.token(result), ";")) {
                        if (std.mem.eql(u8, self.operator(result), "=>")) {
                            body = result + 2;
                            break;
                        }
                        result = (self.pairs.get(result) orelse result) + 1;
                    }
                }
            }
        } else if (self.items[index].kind == .word and std.mem.eql(u8, self.operator(index + 1), "=>")) {
            body = index + 3;
        } else if (std.mem.eql(u8, self.token(index), "function")) {
            var parameter = index + 1;
            while (parameter < limit and !std.mem.eql(u8, self.token(parameter), "(")) parameter = (self.pairs.get(parameter) orelse parameter) + 1;
            const close = self.pairs.get(parameter) orelse return null;
            var candidate = close + 1;
            const type_start: ?usize = if (std.mem.eql(u8, self.token(candidate), ":")) candidate + 1 else null;
            while (candidate < limit) {
                if (std.mem.eql(u8, self.token(candidate), "{")) {
                    if (type_start == null or !try refs.returnTypeExpectsObject(self.allocator, self.source[self.items[type_start.?].start..self.items[candidate].start])) break;
                }
                candidate = (self.pairs.get(candidate) orelse candidate) + 1;
            }
            body = candidate;
        }
        const start = body orelse return null;
        if (start >= limit) return null;
        if (std.mem.eql(u8, self.token(start), "{")) return .{ .start = index, .end = (self.pairs.get(start) orelse (limit - 1)) + 1 };
        var end = start;
        while (end < limit and !oneOf(self.token(end), &.{ ",", ";", ")", "]", "}" })) end = (self.pairs.get(end) orelse end) + 1;
        return .{ .start = index, .end = end };
    }

    fn invalidateWrites(self: *Context, start: usize, end: usize, skip_deferred: bool) syntax.SyntaxError!void {
        var index = start;
        while (index < end) : (index += 1) {
            if (self.instance_initializers.get(index)) |instance_end| {
                index = @min(instance_end, end) - 1;
                continue;
            }
            const deferred = if (skip_deferred) try self.deferredBody(index, end) else null;
            if (deferred) |body| {
                var after = body.end;
                while (std.mem.eql(u8, self.token(after), ")")) after += 1;
                const invoked = std.mem.eql(u8, self.token(after), "(") or
                    (std.mem.eql(u8, self.token(after), ".") and oneOf(self.token(after + 1), &.{ "call", "apply" }) and std.mem.eql(u8, self.token(after + 2), "("));
                if (invoked) try self.invalidateWrites(body.start, body.end, false);
                index = body.end - 1;
                continue;
            }
            if (self.write(index)) |target| {
                target.binding.flow = null;
                target.binding.unresolved = true;
            }
        }
    }

    fn closing(piece: []const u8) []const u8 {
        return if (std.mem.eql(u8, piece, "(")) ")" else if (std.mem.eql(u8, piece, "{")) "}" else "]";
    }

    fn writeRange(self: *Context, limit: usize) !void {
        var structured = false;
        while (self.cursor < self.items.len and self.items[self.cursor].start < limit) {
            const piece = self.token(self.cursor);
            if (oneOf(piece, &.{ "if", "else", "for", "while", "do", "switch", "try", "catch", "finally", "with" })) structured = true;
            if (std.mem.eql(u8, piece, ";")) structured = false;
            if (oneOf(piece, &.{ "(", "{", "[" })) {
                var end = self.pairs.get(self.cursor) orelse (self.cursor + 1);
                while (end < self.items.len and self.items[end].start >= limit) end -= 1;
                try self.invalidateWrites(self.cursor + 1, end, true);
                self.cursor = end + 1;
                if (std.mem.eql(u8, piece, "{")) structured = false;
                continue;
            }
            if (self.assignment(self.cursor)) |binding| {
                const start = self.cursor + 2;
                var end = start;
                var stack = std.array_list.Managed([]const u8).init(self.allocator);
                defer stack.deinit();
                while (end < self.items.len and self.items[end].start < limit) {
                    const item = self.token(end);
                    const line_break = end > start and std.mem.indexOfAny(u8, self.source[self.items[end - 1].end..self.items[end].start], "\r\n") != null;
                    if (stack.items.len == 0 and (std.mem.eql(u8, item, ";") or (line_break and
                        (self.assignment(end) != null or oneOf(item, &.{ "if", "for", "while", "switch", "try", "do", "return", "throw" }))))) break;
                    if (oneOf(item, &.{ "(", "{", "[" })) try stack.append(closing(item)) else if (stack.items.len > 0 and std.mem.eql(u8, item, stack.items[stack.items.len - 1])) _ = stack.pop();
                    end += 1;
                }
                const expression = if (end > start) self.source[self.items[start].start..self.items[end - 1].end] else "";
                try self.invalidateWrites(start, end, true);
                const value = try self.expressionType(expression);
                binding.flow = if (!structured and value.type != null)
                    if (binding.declared) |declared| try assignedType(self.allocator, declared, value.type.?) else value.type
                else
                    null;
                binding.unresolved = structured or value.unresolved or binding.flow == null;
                self.cursor = end;
                continue;
            }
            if (self.write(self.cursor)) |target| {
                target.binding.flow = null;
                target.binding.unresolved = true;
            }
            self.cursor += 1;
        }
    }

    fn declaration(self: *Context, entry: *Declaration) !void {
        try self.writeRange(entry.start);
        const declaration_start = self.cursor;
        while (self.cursor < self.items.len and self.items[self.cursor].start < entry.end) self.cursor += 1;
        if (entry.kind != .variable_decl) return;
        if (entry.initializer_start > 0) {
            var initializer = declaration_start;
            while (initializer < self.cursor and self.items[initializer].start < entry.initializer_start) initializer += 1;
            try self.invalidateWrites(initializer, self.cursor, true);
        }
        const binding = self.bindings.getPtr(entry.name) orelse return;
        if (!binding.active) return;
        if (entry.value.len == 0) {
            binding.flow = binding.declared;
            return;
        }
        const value = try self.expressionType(entry.value);
        const alias = try refs.directConstValueAlias(self.allocator, entry.value);
        const origin = if (alias) |name| self.bindings.get(name) else null;
        const is_const = if (entry.modifiers) |modifiers| modifiers.len > 0 and std.mem.eql(u8, modifiers[0], "const") else false;
        if (self.inferred_calls.get(entry)) |call_type| {
            entry.inferred_type = call_type;
        } else if (entry.type_annotation.len == 0 and is_const and alias != null and !std.mem.eql(u8, alias.?, entry.name) and origin != null) {
            if (value.unresolved) entry.inference_error = .unsupported_value_flow else if (value.type) |value_type| {
                entry.inferred_type = if (origin.?.declared != null and try sameType(self.allocator, origin.?.declared.?, value_type))
                    try std.fmt.allocPrint(self.allocator, "typeof {s}", .{alias.?})
                else
                    value_type;
            }
        }
        if (entry.inferred_type.len > 0) {
            const kind: []const u8 = if (entry.modifiers) |mods| if (mods.len > 0) mods[0] else "const" else "const";
            entry.text = try std.fmt.allocPrint(self.allocator, "{s}declare {s} {s}: {s};", .{ if (entry.is_exported) "export " else "", kind, entry.name, entry.inferred_type });
        }
        if (entry.type_annotation.len > 0) {
            binding.flow = if (value.type) |value_type|
                try assignedType(self.allocator, entry.type_annotation, value_type) orelse entry.type_annotation
            else
                entry.type_annotation;
        } else if (entry.inferred_type.len > 0) {
            binding.declared = entry.inferred_type;
            binding.flow = entry.inferred_type;
        } else {
            const trimmed = std.mem.trim(u8, entry.value, " \t\r\n");
            const container = trimmed.len > 0 and (trimmed[0] == '{' or trimmed[0] == '[');
            const inferred = try type_inf.inferNarrowType(self.allocator, entry.value, is_const and !container, false, 0);
            binding.declared = if (std.mem.eql(u8, inferred, "unknown")) null else inferred;
            binding.flow = binding.declared;
        }
        binding.unresolved = value.unresolved;
    }
};

fn addBinding(allocator: std.mem.Allocator, entry: *Declaration, bindings: *std.StringHashMap(Binding)) !void {
    switch (entry.kind) {
        .function_decl, .class_decl, .enum_decl => {
            const identity = try std.fmt.allocPrint(allocator, "typeof {s}", .{entry.name});
            try bindings.put(entry.name, .{ .declared = identity, .flow = identity });
        },
        .import_decl => if (entry.parsed_import) |parsed| {
            for (parsed.resolved_items) |name| {
                const identity = try std.fmt.allocPrint(allocator, "typeof {s}", .{name});
                try bindings.put(name, .{ .declared = identity, .flow = identity });
            }
        },
        .variable_decl => try bindings.put(entry.name, .{ .declared = if (entry.type_annotation.len > 0) entry.type_annotation else null }),
        else => {},
    }
}

fn sourceOrder(_: void, left: *Declaration, right: *Declaration) bool {
    return left.start < right.start;
}

pub fn inferDeclarationValueAliases(allocator: std.mem.Allocator, source: []const u8, declarations: []Declaration, candidates: *std.StringHashMap(Declaration)) !void {
    return inferDeclarationValueAliasesWithImports(allocator, source, null, declarations, candidates, null);
}

/// Prepare emitted call queries before private closure without semantic flow analysis.
pub fn inferDeclarationCallTypes(allocator: std.mem.Allocator, declarations: []Declaration, candidates: *std.StringHashMap(Declaration)) !void {
    for (declarations) |*entry| try inferDeclarationCallType(allocator, entry);
    var values = candidates.valueIterator();
    while (values.next()) |entry| try inferDeclarationCallType(allocator, entry);
}

fn inferDeclarationCallType(allocator: std.mem.Allocator, entry: *Declaration) !void {
    if (entry.kind != .variable_decl or entry.type_annotation.len > 0) return;
    if (try type_inf.inferCallType(allocator, entry.value)) |call| {
        const inferred = try type_inf.inferNarrowType(allocator, entry.value, false, false, 0);
        if (std.mem.eql(u8, call, inferred)) {
            entry.inferred_type = call;
            const kind: []const u8 = if (entry.modifiers) |mods| if (mods.len > 0) mods[0] else "const" else "const";
            entry.text = try std.fmt.allocPrint(allocator, "{s}declare {s} {s}: {s};", .{ if (entry.is_exported) "export " else "", kind, entry.name, call });
        }
    }
}

/// `source_tokens`, when supplied, must be the declaration-syntax tokens of
/// `source`; they are borrowed and never freed here.
pub fn inferDeclarationValueAliasesWithImports(allocator: std.mem.Allocator, source: []const u8, source_tokens: ?[]const syntax.SyntaxToken, declarations: []Declaration, candidates: *std.StringHashMap(Declaration), imports: ?*const std.StringHashMap(void)) !void {
    try inferDeclarationCallTypes(allocator, declarations, candidates);
    var context = Context{
        .allocator = allocator,
        .source = source,
        .items = &.{},
        .bindings = std.StringHashMap(Binding).init(allocator),
        .pairs = std.AutoHashMap(usize, usize).init(allocator),
        .parents = std.AutoHashMap(usize, usize).init(allocator),
        .object_literals = std.AutoHashMap(usize, void).init(allocator),
        .class_bodies = std.AutoHashMap(usize, void).init(allocator),
        .class_member_syntax = std.AutoHashMap(usize, void).init(allocator),
        .instance_initializers = std.AutoHashMap(usize, usize).init(allocator),
        .operators = std.AutoHashMap(usize, []const u8).init(allocator),
        .local_calls = std.StringHashMap(LocalCall).init(allocator),
        .functions = std.StringHashMap(void).init(allocator),
        .inferred_calls = std.AutoHashMap(*Declaration, []const u8).init(allocator),
    };
    defer context.bindings.deinit();
    defer context.pairs.deinit();
    defer context.parents.deinit();
    defer context.object_literals.deinit();
    defer context.class_bodies.deinit();
    defer context.class_member_syntax.deinit();
    defer context.instance_initializers.deinit();
    defer context.operators.deinit();
    defer context.local_calls.deinit();
    defer context.functions.deinit();
    defer context.inferred_calls.deinit();
    var ordered = std.array_list.Managed(*Declaration).init(allocator);
    defer ordered.deinit();
    for (declarations) |*entry| {
        try ordered.append(entry);
        try addBinding(allocator, entry, &context.bindings);
    }
    var values = candidates.valueIterator();
    while (values.next()) |entry| {
        try ordered.append(entry);
        try addBinding(allocator, entry, &context.bindings);
    }
    std.mem.sort(*Declaration, ordered.items, {}, sourceOrder);
    for (ordered.items) |entry| if (entry.kind == .function_decl and entry.generics.len == 0) try context.functions.put(entry.name, {});
    if (imports) |known| {
        var names = known.keyIterator();
        while (names.next()) |name| {
            try context.functions.put(name.*, {});
            var inferred_name: []const u8 = "__dtsx_call_result";
            while (std.mem.indexOf(u8, source, inferred_name) != null) inferred_name = try std.fmt.allocPrint(allocator, "{s}_", .{inferred_name});
            const call_type = try std.fmt.allocPrint(allocator, "(typeof {s}) extends (...args: never[]) => infer {s} ? {s} : never", .{ name.*, inferred_name, inferred_name });
            try context.local_calls.put(name.*, .{ .type = call_type, .flow = call_type });
        }
    }
    var has_call = false;
    for (ordered.items) |entry| {
        if (entry.kind == .variable_decl and entry.type_annotation.len == 0 and try directCall(allocator, entry.value, &context.functions) != null) {
            has_call = true;
            break;
        }
    }
    const owned_items: ?[]const syntax.SyntaxToken = if (has_call and source_tokens == null) try syntax.tokenizeDeclarationSyntax(allocator, source) else null;
    defer if (owned_items) |tokens| allocator.free(tokens);
    const source_items: ?[]const syntax.SyntaxToken = if (has_call) (source_tokens orelse owned_items) else null;
    if (source_items) |tokens| {
        var counts = std.StringHashMap(usize).init(allocator);
        defer counts.deinit();
        var depth: isize = 0;
        for (tokens, 0..) |item, index| {
            const piece = source[item.start..item.end];
            if (depth == 0 and std.mem.eql(u8, piece, "function") and index + 1 < tokens.len) {
                const following = tokens[index + 1];
                const next_index = if (std.mem.eql(u8, source[following.start..following.end], "*")) index + 2 else index + 1;
                if (next_index < tokens.len and tokens[next_index].kind == .word) {
                    const name = source[tokens[next_index].start..tokens[next_index].end];
                    const entry = try counts.getOrPut(name);
                    if (!entry.found_existing) entry.value_ptr.* = 0;
                    entry.value_ptr.* += 1;
                }
            }
            if (oneOf(piece, &.{ "{", "(", "[" })) depth += 1 else if (oneOf(piece, &.{ "}", ")", "]" })) depth -= 1;
        }
        var inferred_name: []const u8 = "__dtsx_call_result";
        while (std.mem.indexOf(u8, source, inferred_name) != null) inferred_name = try std.fmt.allocPrint(allocator, "{s}_", .{inferred_name});
        for (ordered.items) |entry| {
            if (entry.kind != .function_decl or entry.generics.len > 0 or counts.get(entry.name) != 1) continue;
            const call_type = try std.fmt.allocPrint(allocator, "(typeof {s}) extends (...args: never[]) => infer {s} ? {s} : never", .{ entry.name, inferred_name, inferred_name });
            const return_type = try functionReturn(allocator, entry.text);
            const flow = if (return_type.len > 0 and try primitive(allocator, return_type) != null) return_type else call_type;
            try context.local_calls.put(entry.name, .{ .type = call_type, .flow = flow });
        }
    }
    var has_alias = false;
    for (ordered.items) |entry| {
        if (entry.kind != .variable_decl or entry.type_annotation.len > 0) continue;
        if (try directCall(allocator, entry.value, &context.functions)) |name| {
            if (context.local_calls.get(name)) |call| {
                try context.inferred_calls.put(entry, call.type);
                if (context.bindings.getPtr(entry.name)) |binding| binding.active = true;
                if (context.bindings.getPtr(name)) |binding| binding.active = true;
                has_alias = true;
            }
        }
        const modifiers = entry.modifiers orelse continue;
        if (modifiers.len == 0 or !std.mem.eql(u8, modifiers[0], "const")) continue;
        const alias = try refs.directConstValueAlias(allocator, entry.value) orelse continue;
        if (std.mem.eql(u8, alias, entry.name)) continue;
        const origin = context.bindings.getPtr(alias) orelse continue;
        origin.active = true;
        if (context.bindings.getPtr(entry.name)) |binding| binding.active = true;
        has_alias = true;
    }
    if (!has_alias) return;
    const late_items: ?[]const syntax.SyntaxToken = if (source_items == null and source_tokens == null) try syntax.tokenizeDeclarationSyntax(allocator, source) else null;
    defer if (late_items) |tokens| allocator.free(tokens);
    const items = source_items orelse source_tokens orelse late_items.?;
    context.items = items;
    var delimiters = std.array_list.Managed(usize).init(allocator);
    defer delimiters.deinit();
    for (items, 0..) |_, index| {
        const piece = context.token(index);
        if (delimiters.items.len > 0) try context.parents.put(index, delimiters.items[delimiters.items.len - 1]);
        if (std.mem.eql(u8, piece, "{") and index > 0 and oneOf(context.token(index - 1), &.{ "=", "(", "[", ",", ":", "?", "return", "yield" })) try context.object_literals.put(index, {});
        if (oneOf(piece, &.{ "(", "[", "{" })) try delimiters.append(index) else if (oneOf(piece, &.{ ")", "]", "}" }) and delimiters.items.len > 0) {
            const open = delimiters.items[delimiters.items.len - 1];
            if (std.mem.eql(u8, Context.closing(context.token(open)), piece)) {
                _ = delimiters.pop();
                try context.pairs.put(open, index);
            }
        }
    }
    // Consume longest operators once. Interior punctuation is never eligible
    // to start an overlapping prefix update on a later identifier.
    const choices = [_][]const u8{ ">>>=", "**=", "&&=", "||=", "??=", "<<=", ">>=", "===", "!==", ">>>", "**", "&&", "||", "??", "<<", ">>", "=>", "==", "!=", "<=", ">=", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "=" };
    var index: usize = 0;
    while (index < items.len) {
        if (items[index].kind != .punctuation) {
            index += 1;
            continue;
        }
        var spelling = context.token(index);
        for (choices) |choice| {
            if (std.mem.startsWith(u8, source[items[index].start..], choice)) {
                spelling = choice;
                break;
            }
        }
        try context.operators.put(index, spelling);
        const end = items[index].start + spelling.len;
        index += 1;
        while (index < items.len and items[index].start < end) index += 1;
    }
    // Member-scope classification does not skip evaluated class syntax.
    for (items, 0..) |_, candidate| {
        if (try context.findClassBody(candidate)) |body| try context.class_bodies.put(body, {});
    }
    var bodies = context.class_bodies.keyIterator();
    while (bodies.next()) |body| try context.classifyClassMembers(body.*);
    for (ordered.items) |entry| try context.declaration(entry);
}
