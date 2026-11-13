//! Type spans in value initializers. Mirrors initializer-type-spans.ts.
const std = @import("std");
const syntax = @import("module_specifiers.zig");
const inference = @import("numeric_literals.zig");
const Error = std.mem.Allocator.Error;

pub const Span = struct { end: usize, complete_operand: bool, parameters: bool = false };

pub const Reader = struct {
    source: []const u8,
    tokens: []const syntax.SyntaxToken,
    allocator: std.mem.Allocator,
    index: usize = 0,
    owns_tokens: bool = false,
    signature_start: ?usize = null,
    signature_end: ?usize = null,
    group_ends: ?[]usize = null,
    type_results: [2]std.AutoHashMapUnmanaged(usize, isize) = .{ .empty, .empty },

    pub fn initOwned(allocator: std.mem.Allocator, source: []const u8) syntax.SyntaxError!Reader {
        return .{ .source = source, .allocator = allocator, .tokens = try syntax.tokenizeDeclarationSyntax(allocator, source), .owns_tokens = true };
    }

    pub fn deinit(self: *Reader) void {
        if (self.owns_tokens) self.allocator.free(self.tokens);
        if (self.group_ends) |ends| self.allocator.free(ends);
        for (&self.type_results) |*results| results.deinit(self.allocator);
    }

    fn at(self: *const Reader, index: usize) []const u8 {
        if (index >= self.tokens.len) return "";
        const token = self.tokens[index];
        return self.source[token.start..token.end];
    }

    fn text(self: *const Reader) []const u8 {
        return self.at(self.index);
    }

    fn is(self: *const Reader, value: []const u8) bool {
        return std.mem.eql(u8, self.text(), value);
    }

    fn word(self: *const Reader, index: usize) bool {
        return index < self.tokens.len and self.tokens[index].kind == .word;
    }

    fn quoted(self: *const Reader) bool {
        return self.index < self.tokens.len and self.tokens[self.index].kind == .quoted;
    }

    fn lineBreak(self: *const Reader, before: usize, after: usize) bool {
        return std.mem.indexOfAny(u8, self.source[before..after], "\r\n") != null;
    }

    fn eat(self: *Reader, value: []const u8) bool {
        if (!self.is(value)) return false;
        self.index += 1;
        return true;
    }

    fn sequence(self: *Reader, value: []const u8) bool {
        const saved = self.index;
        for (value) |char| {
            if (!self.eat(&.{char}) or (self.index > saved + 1 and self.tokens[self.index - 2].end != self.tokens[self.index - 1].start)) {
                self.index = saved;
                return false;
            }
        }
        return true;
    }

    fn attempt(self: *Reader, comptime parse: fn (*Reader) Error!bool) Error!bool {
        const saved = self.index;
        if (try parse(self)) return true;
        self.index = saved;
        return false;
    }

    fn identifier(self: *Reader) bool {
        if (!self.word(self.index)) return false;
        self.index += 1;
        return true;
    }

    fn numeric(self: *Reader) bool {
        const start = self.index;
        var end = start;
        while (end < self.tokens.len and (end == start or self.tokens[end - 1].end == self.tokens[end].start)) : (end += 1) {
            const value = self.at(end);
            const previous = if (end > 0) self.at(end - 1) else "";
            const exponent_sign = (std.mem.eql(u8, value, "+") or std.mem.eql(u8, value, "-")) and previous.len > 0 and (previous[previous.len - 1] == 'e' or previous[previous.len - 1] == 'E');
            if (!self.word(end) and !(value.len == 1 and std.mem.indexOfScalar(u8, "0123456789.", value[0]) != null) and !exponent_sign) break;
        }
        if (end == start) return false;
        const literal = self.source[self.tokens[start].start..self.tokens[end - 1].end];
        if (!inference.isNumericLiteral(literal) and !inference.isBigIntLiteral(literal)) return false;
        self.index = end;
        return true;
    }

    fn group(self: *Reader) Error!bool {
        if (!contains(&.{ "(", "[", "{" }, self.text())) return false;
        if (self.group_ends == null) {
            const ends = try self.allocator.alloc(usize, self.tokens.len);
            errdefer self.allocator.free(ends);
            @memset(ends, std.math.maxInt(usize));
            var openings = std.array_list.Managed(usize).init(self.allocator);
            defer openings.deinit();
            for (self.tokens, 0..) |_, token_index| {
                const value = self.at(token_index);
                if (contains(&.{ "(", "[", "{" }, value)) {
                    try openings.append(token_index);
                } else if (contains(&.{ ")", "]", "}" }, value)) {
                    if (openings.pop()) |opening| {
                        const open = self.at(opening)[0];
                        const close: u8 = switch (open) {
                            '(' => ')',
                            '[' => ']',
                            else => '}',
                        };
                        if (value[0] == close) ends[opening] = token_index + 1 else openings.clearRetainingCapacity();
                    }
                }
            }
            self.group_ends = ends;
        }
        const end = self.group_ends.?[self.index];
        if (end == std.math.maxInt(usize)) return false;
        self.index = end;
        return true;
    }

    fn bindingName(self: *Reader) Error!bool {
        return self.identifier() or ((self.is("{") or self.is("[")) and try self.group());
    }

    fn parameters(self: *Reader) Error!bool {
        if (!self.eat("(")) return false;
        if (self.eat(")")) return true;
        while (true) {
            _ = self.sequence("...");
            if (!try self.bindingName()) return false;
            _ = self.eat("?");
            if (self.eat(":") and !try self.type_(true)) return false;
            if (self.is(")")) break;
            if (!self.eat(",") or self.is(")")) break;
        }
        return self.eat(")");
    }

    fn typeParameters(self: *Reader) Error!bool {
        if (!self.eat("<") or self.is(">")) return false;
        while (true) {
            _ = self.eat("const");
            while ((self.is("in") or self.is("out")) and self.word(self.index + 1) and !std.mem.eql(u8, self.at(self.index + 1), "extends")) self.index += 1;
            if (!self.identifier()) return false;
            if (self.eat("extends") and !try self.type_(false)) return false;
            if (self.eat("=") and !try self.type_(true)) return false;
            if (self.is(">")) break;
            if (!self.eat(",") or self.is(">")) break;
        }
        return self.eat(">");
    }

    fn typeArguments(self: *Reader) Error!bool {
        if (!self.eat("<") or self.is(">")) return false;
        while (true) {
            if (!try self.type_(true)) return false;
            if (self.is(">")) break;
            if (!self.eat(",") or self.is(">")) break;
        }
        return self.eat(">");
    }

    fn functionType(self: *Reader) Error!bool {
        _ = self.eat("abstract");
        _ = self.eat("new");
        if (self.is("<") and !try self.typeParameters()) return false;
        return try self.parameters() and self.sequence("=>") and try self.returnType();
    }

    fn templateType(self: *Reader) Error!bool {
        if (self.index >= self.tokens.len or self.tokens[self.index].kind != .template or self.text().len == 0 or self.text()[0] != '`') return false;
        while (self.index < self.tokens.len) {
            const token = self.tokens[self.index];
            self.index += 1;
            if (self.source[token.end - 1] == '`') return true;
            if (self.source[token.end - 1] != '$' or !self.eat("{") or !try self.type_(true) or !self.eat("}")) return false;
            if (self.index >= self.tokens.len or self.tokens[self.index].kind != .template) return false;
        }
        return false;
    }

    fn tuple(self: *Reader) Error!bool {
        if (!self.eat("[")) return false;
        if (self.eat("]")) return true;
        while (true) {
            _ = self.sequence("...");
            const saved = self.index;
            if (self.word(self.index) or self.quoted()) {
                self.index += 1;
                _ = self.eat("?");
                if (!self.eat(":")) self.index = saved;
            }
            if (!try self.type_(true)) return false;
            _ = self.eat("?");
            if (self.is("]")) break;
            if (!self.eat(",") or self.is("]")) break;
        }
        return self.eat("]");
    }

    fn returnType(self: *Reader) Error!bool {
        if (self.eat("asserts")) {
            if (!self.identifier()) return false;
            return !self.eat("is") or try self.type_(true);
        }
        if (self.word(self.index) and std.mem.eql(u8, self.at(self.index + 1), "is")) {
            self.index += 2;
            return self.type_(true);
        }
        return self.type_(true);
    }

    fn signature(self: *Reader) Error!bool {
        if (self.is("<") and !try self.typeParameters()) return false;
        if (!try self.parameters()) return false;
        return !self.eat(":") or try self.returnType();
    }

    fn bracketMember(self: *Reader) Error!bool {
        if (!self.eat("[")) return false;
        if (self.word(self.index) and (std.mem.eql(u8, self.at(self.index + 1), "in") or std.mem.eql(u8, self.at(self.index + 1), ":"))) {
            self.index += 1;
            const mapped = self.eat("in");
            if (!mapped and !self.eat(":")) return false;
            if (!try self.type_(true)) return false;
            if (mapped and self.eat("as") and !try self.type_(true)) return false;
        } else {
            if (!self.identifier() and !self.numeric()) {
                if (!self.quoted()) return false;
                self.index += 1;
            }
            while (self.eat(".")) if (!self.identifier()) return false;
        }
        return self.eat("]");
    }

    fn memberName(self: *Reader) Error!bool {
        if (self.is("[")) return self.bracketMember();
        if (self.identifier() or self.numeric()) return true;
        if (!self.quoted()) return false;
        self.index += 1;
        return true;
    }

    fn accessorModifier(self: *Reader) Error!void {
        if (!self.is("get") and !self.is("set")) return;
        const start = self.index;
        self.index += 1;
        const accessor = try self.memberName() and self.is("(");
        self.index = if (accessor) start + 1 else start;
    }

    fn objectType(self: *Reader) Error!bool {
        if (!self.eat("{")) return false;
        while (!self.eat("}")) {
            if (self.index >= self.tokens.len) return false;
            const start = self.index;
            if ((self.is("+") or self.is("-")) and std.mem.eql(u8, self.at(self.index + 1), "readonly")) self.index += 1;
            if (self.is("readonly") and !contains(&.{ ":", "?", "(", ";", "}" }, self.at(self.index + 1))) self.index += 1;
            if (self.is("new") and contains(&.{ "(", "<" }, self.at(self.index + 1))) self.index += 1;
            if (self.is("(") or self.is("<")) {
                if (!try self.signature()) return false;
            } else {
                try self.accessorModifier();
                if (!try self.memberName()) return false;
                if (self.is("+") or self.is("-")) {
                    self.index += 1;
                    if (!self.eat("?")) return false;
                } else _ = self.eat("?");
                if (self.eat(":")) {
                    if (!try self.type_(true)) return false;
                } else if (self.is("(") or self.is("<")) {
                    if (!try self.signature()) return false;
                }
            }
            if (self.index == start) return false;
            if (self.eat(";") or self.eat(",")) continue;
            const next_start = if (self.index < self.tokens.len) self.tokens[self.index].start else self.source.len;
            if (!self.is("}") and !self.lineBreak(self.tokens[self.index - 1].end, next_start)) return false;
        }
        return true;
    }

    fn primary(self: *Reader) Error!bool {
        if (try self.attempt(functionType)) return true;
        if (self.eat("(")) return try self.type_(true) and self.eat(")");
        if (self.is("{")) return self.objectType();
        if (self.is("[")) return self.tuple();
        if (try self.attempt(templateType)) return true;
        if (self.quoted()) {
            self.index += 1;
            return true;
        }
        if (self.eat("-")) return self.numeric();
        if (self.numeric()) return true;
        if (self.eat("typeof")) {
            if (self.is("import")) return self.primary();
            if (!self.identifier()) return false;
            while (self.eat(".")) if (!self.identifier()) return false;
            if (self.is("<") and !try self.typeArguments()) return false;
            return true;
        }
        if (self.eat("import")) {
            if (!self.eat("(") or !try self.type_(true)) return false;
            if (self.eat(",") and !try self.objectType()) return false;
            return self.eat(")");
        }
        if (contains(&.{ "export", "function", "class", "const", "let", "var", "return", "throw", "default", "new", "abstract" }, self.text())) return false;
        return self.identifier();
    }

    fn unary(self: *Reader) Error!bool {
        if (contains(&.{ "keyof", "readonly", "unique" }, self.text())) {
            self.index += 1;
            return self.unary();
        }
        if (self.eat("infer")) {
            if (!self.identifier()) return false;
            if (self.eat("extends") and !try self.type_(false)) return false;
            return true;
        }
        if (!try self.primary()) return false;
        while (true) {
            if (self.eat(".")) {
                if (!self.identifier()) return false;
            } else if (self.is("<")) {
                if (self.lineBreak(self.tokens[self.index - 1].end, self.tokens[self.index].start)) return true;
                if (!try self.typeArguments()) return false;
            } else if (self.is("[")) {
                if (self.lineBreak(self.tokens[self.index - 1].end, self.tokens[self.index].start)) return true;
                self.index += 1;
                if (!self.eat("]") and !(try self.type_(true) and self.eat("]"))) return false;
            } else return true;
        }
    }

    fn intersection(self: *Reader) Error!bool {
        _ = self.eat("&");
        if (!try self.unary()) return false;
        while (self.eat("&")) if (!try self.unary()) return false;
        return true;
    }

    fn type_(self: *Reader, conditional: bool) Error!bool {
        const start = self.index;
        const results = &self.type_results[@intFromBool(conditional)];
        if (results.get(start)) |cached| {
            if (cached < 0) return false;
            self.index = @intCast(cached);
            return true;
        }
        const success = try self.parseType(conditional);
        try results.put(self.allocator, start, if (success) @intCast(self.index) else -1);
        if (!success) self.index = start;
        return success;
    }

    fn parseType(self: *Reader, conditional: bool) Error!bool {
        _ = self.eat("|");
        if (!try self.intersection()) return false;
        while (self.eat("|")) if (!try self.intersection()) return false;
        if (conditional and self.is("extends") and !self.lineBreak(self.tokens[self.index - 1].end, self.tokens[self.index].start)) {
            self.index += 1;
            return try self.type_(false) and self.eat("?") and try self.type_(true) and self.eat(":") and try self.type_(true);
        }
        return true;
    }

    fn arrowAfterParameters(self: *Reader) Error!bool {
        if (!self.is("(") or !try self.group()) return false;
        if (self.eat(":") and !try self.returnType()) return false;
        return self.sequence("=>");
    }

    fn runtimeSignature(self: *Reader) Error!bool {
        _ = self.eat("async");
        const function_expression = self.eat("function");
        if (function_expression) {
            _ = self.eat("*");
            if (self.word(self.index)) self.index += 1;
        }
        if (self.is("<") and !try self.typeParameters()) return false;
        if (!self.is("(") or !try self.group()) return false;
        if (self.eat(":") and !try self.returnType()) return false;
        return if (function_expression) self.is("{") else self.sequence("=>");
    }

    fn followsExpressionArguments(self: *Reader) bool {
        const value = self.text();
        if (contains(&.{ "<", ">", "+", "-" }, value)) return false;
        if (self.is("(") or (self.index < self.tokens.len and self.tokens[self.index].kind == .template and value.len > 0 and value[0] == '`')) return true;
        if (self.index >= self.tokens.len or self.lineBreak(self.tokens[self.index - 1].end, self.tokens[self.index].start)) return true;
        if (contains(&.{ "*", "/", "%", "=", "&", "|", "^", "?", ":", ",", ";", ")", "]", "}", "in", "instanceof", "as", "satisfies" }, value)) return true;
        if (self.is("!")) return std.mem.eql(u8, self.at(self.index + 1), "=") and self.index + 1 < self.tokens.len and self.tokens[self.index].end == self.tokens[self.index + 1].start;
        return !self.word(self.index) and !self.quoted() and self.tokens[self.index].kind != .template and
            !contains(&.{ "{", "[", "~", "#", "@" }, value) and !(value.len == 1 and std.ascii.isDigit(value[0]));
    }

    pub fn read(self: *Reader, opening: usize, initializer_start: usize, previous_operand_end: ?usize) Error!?Span {
        var low: usize = 0;
        var high = self.tokens.len;
        while (low < high) {
            const middle = (low + high) / 2;
            if (self.tokens[middle].start < opening) low = middle + 1 else high = middle;
        }
        if (low >= self.tokens.len or self.tokens[low].start != opening) return null;
        if (self.signature_start != initializer_start) {
            self.signature_start = initializer_start;
            self.signature_end = null;
            var start: usize = 0;
            var end = low;
            while (start < end) {
                const middle = (start + end) / 2;
                if (self.tokens[middle].start < initializer_start) start = middle + 1 else end = middle;
            }
            self.index = start;
            if (try self.runtimeSignature()) self.signature_end = if (self.is("{")) self.tokens[self.index].start else self.tokens[self.index - 1].end;
        }
        if (self.signature_end) |end| {
            if (opening < end) return .{ .end = end, .complete_operand = false, .parameters = true };
        }
        if (!std.mem.eql(u8, self.at(low), "<")) return null;
        self.index = low;
        const previous = if (low > 0) self.at(low - 1) else "";
        const prefix = opening == initializer_start or contains(&.{ "=", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "?", ":", "<", ">", "void", "typeof", "await", "yield", "delete" }, previous);
        const header = contains(&.{ "function", "class" }, previous) or (low >= 2 and std.mem.eql(u8, previous, "*") and std.mem.eql(u8, self.at(low - 2), "function")) or (low >= 2 and self.word(low - 1) and (contains(&.{ "function", "class" }, self.at(low - 2)) or (low >= 3 and std.mem.eql(u8, self.at(low - 2), "*") and std.mem.eql(u8, self.at(low - 3), "function"))));
        if (header and try self.attempt(typeParameters)) return .{ .end = self.tokens[self.index - 1].end, .complete_operand = false, .parameters = true };
        self.index = low;
        if ((prefix or std.mem.eql(u8, previous, "async")) and try self.attempt(typeParameters)) {
            const end = self.tokens[self.index - 1].end;
            if (try self.attempt(arrowAfterParameters)) return .{ .end = end, .complete_operand = false, .parameters = true };
        }
        self.index = low;
        const optional_call = low >= 2 and std.mem.eql(u8, previous, ".") and std.mem.eql(u8, self.at(low - 2), "?") and self.tokens[low - 2].end == self.tokens[low - 1].start;
        const callee = low > 0 and self.tokens[low - 1].end >= initializer_start and (optional_call or self.word(low - 1) or contains(&.{ ")", "]", "!" }, previous) or (std.mem.eql(u8, previous, ">") and previous_operand_end != null and self.tokens[low - 1].end == previous_operand_end.?));
        if (callee and try self.attempt(typeArguments) and self.followsExpressionArguments()) return .{ .end = self.tokens[self.index - 1].end, .complete_operand = true };
        self.index = low;
        if (prefix and self.eat("<") and try self.type_(true) and self.eat(">")) return .{ .end = self.tokens[self.index - 1].end, .complete_operand = false };
        return null;
    }
};

fn contains(values: []const []const u8, value: []const u8) bool {
    for (values) |candidate| if (std.mem.eql(u8, candidate, value)) return true;
    return false;
}
