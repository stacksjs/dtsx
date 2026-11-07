//! Binding syntax and legal ambient parameter projections. Results share the
//! owning declaration arena, as do all other native scanner declarations.
const std = @import("std");
const syntax = @import("module_specifiers.zig");
const Declaration = @import("types.zig").Declaration;
const Allocator = std.mem.Allocator;
const Expression = struct { text: []const u8, offset: usize };
const Target = struct {
    kind: enum { name, object, array },
    name: []const u8 = "",
    elements: []const ?Element = &.{},
    default_value: ?Expression = null,
};
const Element = struct { key: []const u8 = "", computed: ?Expression = null, rest: bool = false, target: *Target };

pub const Names = struct {
    allocator: Allocator,
    source: []const u8,
    counter: *usize,

    pub fn next(self: *Names) ![]const u8 {
        while (true) {
            const name = try std.fmt.allocPrint(self.allocator, "__dtsx_binding_{d}", .{self.counter.*});
            self.counter.* += 1;
            // Reserving all spellings (including implementation-only strings)
            // is conservative and avoids allocating a second source token graph.
            if (std.mem.indexOf(u8, self.source, name) == null) return name;
        }
    }
};

fn oneOf(value: []const u8, choices: []const []const u8) bool {
    for (choices) |choice| if (std.mem.eql(u8, value, choice)) return true;
    return false;
}

const Parser = struct {
    allocator: Allocator,
    source: []const u8,
    tokens: []const syntax.SyntaxToken,
    pairs: std.AutoHashMap(usize, usize),

    fn token(self: *const Parser, index: usize) []const u8 {
        return if (index < self.tokens.len) self.source[self.tokens[index].start..self.tokens[index].end] else "";
    }

    fn raw(self: *const Parser, start: usize, end: usize) Expression {
        return .{ .text = if (start < end) self.source[self.tokens[start].start..self.tokens[end - 1].end] else "", .offset = if (start < self.tokens.len) self.tokens[start].start else self.source.len };
    }

    fn top(self: *const Parser, start: usize, end: usize, marker: []const u8) ?usize {
        var index = start;
        while (index < end) : (index = (self.pairs.get(index) orelse index) + 1) {
            if (std.mem.eql(u8, self.token(index), marker)) return index;
        }
        return null;
    }

    fn target(self: *Parser, start: usize, original_end: usize) anyerror!*Target {
        const equal = self.top(start, original_end, "=");
        const end = equal orelse original_end;
        const fallback = if (equal) |index| self.raw(index + 1, original_end) else null;
        const result = try self.allocator.create(Target);
        if (start + 1 == end and self.tokens[start].kind == .word) {
            result.* = .{ .kind = .name, .name = self.token(start), .default_value = fallback };
            return result;
        }
        const object = std.mem.eql(u8, self.token(start), "{");
        if ((!object and !std.mem.eql(u8, self.token(start), "[")) or self.pairs.get(start) != end -| 1) return error.InvalidBindingPattern;
        var elements = std.array_list.Managed(?Element).init(self.allocator);
        defer elements.deinit();
        var item = start + 1;
        while (item < end - 1) {
            const comma = self.top(item, end - 1, ",");
            const stop = comma orelse end - 1;
            if (item == stop) {
                try elements.append(null);
            } else if (std.mem.eql(u8, self.token(item), ".") and std.mem.eql(u8, self.token(item + 1), ".") and std.mem.eql(u8, self.token(item + 2), ".")) {
                try elements.append(.{ .rest = true, .target = try self.target(item + 3, stop) });
            } else if (!object) {
                try elements.append(.{ .target = try self.target(item, stop) });
            } else if (std.mem.eql(u8, self.token(item), "[")) {
                const close = self.pairs.get(item) orelse return error.InvalidBindingPattern;
                if (!std.mem.eql(u8, self.token(close + 1), ":")) return error.InvalidBindingPattern;
                try elements.append(.{ .computed = self.raw(item + 1, close), .target = try self.target(close + 2, stop) });
            } else {
                var colon = item + 1;
                if (self.tokens[item].kind != .word and self.tokens[item].kind != .quoted) {
                    while (colon < stop and !std.mem.eql(u8, self.token(colon), ":")) colon += 1;
                }
                const aliased = std.mem.eql(u8, self.token(colon), ":");
                if (!aliased and self.tokens[item].kind != .word) return error.InvalidBindingPattern;
                try elements.append(.{ .key = self.raw(item, if (aliased) colon else item + 1).text, .target = try self.target(if (aliased) colon + 1 else item, stop) });
            }
            item = if (comma) |index| index + 1 else break;
        }
        result.* = .{ .kind = if (object) .object else .array, .elements = try elements.toOwnedSlice(), .default_value = fallback };
        return result;
    }

    fn parse(self: *Parser) !*Target {
        var stack = std.array_list.Managed(usize).init(self.allocator);
        defer stack.deinit();
        for (self.tokens, 0..) |_, index| {
            const spelling = self.token(index);
            if (oneOf(spelling, &.{ "(", "[", "{" })) {
                try stack.append(index);
            } else if (oneOf(spelling, &.{ ")", "]", "}" })) {
                const open = stack.pop() orelse return error.InvalidBindingPattern;
                const opener = self.token(open);
                if (!((std.mem.eql(u8, opener, "(") and std.mem.eql(u8, spelling, ")")) or
                    (std.mem.eql(u8, opener, "[") and std.mem.eql(u8, spelling, "]")) or
                    (std.mem.eql(u8, opener, "{") and std.mem.eql(u8, spelling, "}")))) return error.InvalidBindingPattern;
                try self.pairs.put(open, index);
            }
        }
        if (stack.items.len > 0) return error.InvalidBindingPattern;
        for (self.tokens, 0..) |_, open| {
            if (!std.mem.eql(u8, self.token(open), "<")) continue;
            const allow_defaults = open > 0 and oneOf(self.token(open - 1), &.{ "=", ",", "(", ":", "?", "[", "{" });
            var depth: usize = 1;
            var index = open + 1;
            while (index < self.tokens.len) : (index = (self.pairs.get(index) orelse index) + 1) {
                const spelling = self.token(index);
                if (std.mem.eql(u8, spelling, "=") and !std.mem.eql(u8, self.token(index + 1), ">") and depth == 1 and !allow_defaults) break;
                if (std.mem.eql(u8, spelling, "<")) depth += 1 else if (std.mem.eql(u8, spelling, ">") and !std.mem.eql(u8, self.token(index - 1), "=")) {
                    depth -= 1;
                    if (depth == 0) {
                        if (index + 1 == self.tokens.len or oneOf(self.token(index + 1), &.{ "(", "[", ".", ",", "}", "]", ")", "?", ":", ";", "=", ">" })) try self.pairs.put(open, index);
                        break;
                    }
                }
            }
        }
        return self.target(0, self.tokens.len);
    }
};

fn appendNames(target: *const Target, names: *std.array_list.Managed([]const u8)) anyerror!void {
    if (target.kind == .name) return names.append(target.name);
    for (target.elements) |element| if (element) |entry| try appendNames(entry.target, names);
}

pub fn bindingPatternNames(allocator: Allocator, pattern: []const u8) ![]const []const u8 {
    var parser = Parser{ .allocator = allocator, .source = pattern, .tokens = try syntax.tokenizeDeclarationSyntax(allocator, pattern), .pairs = std.AutoHashMap(usize, usize).init(allocator) };
    defer allocator.free(parser.tokens);
    defer parser.pairs.deinit();
    var names = std.array_list.Managed([]const u8).init(allocator);
    defer names.deinit();
    try appendNames(try parser.parse(), &names);
    return names.toOwnedSlice();
}

pub const Options = struct {
    pattern: []const u8,
    pattern_offset: usize,
    root: Declaration,
    kind: []const u8,
    exported: bool,
    comments: ?[]const []const u8 = null,
};

const Projector = struct {
    allocator: Allocator,
    names: *Names,
    options: Options,
    declarations: std.array_list.Managed(Declaration),
    commented: bool = false,

    fn value(self: *Projector, expression: Expression, kind: []const u8) ![]const u8 {
        const name = try self.names.next();
        const mods = try self.allocator.alloc([]const u8, 1);
        mods[0] = kind;
        try self.declarations.append(.{ .kind = .variable_decl, .name = name, .text = try std.fmt.allocPrint(self.allocator, "declare {s} {s}: unknown;", .{ kind, name }), .value = expression.text, .initializer_start = self.options.pattern_offset + expression.offset, .modifiers = mods, .start = self.options.root.start, .end = self.options.root.end });
        return name;
    }

    fn project(self: *Projector, target: *const Target, original_type: []const u8) anyerror!void {
        var source_type = original_type;
        if (target.default_value) |fallback| {
            const value_name = try self.value(fallback, self.options.kind);
            const member = try self.names.next();
            source_type = try std.fmt.allocPrint(self.allocator, "({s}) extends infer {s} ? {s} extends undefined ? typeof {s} : {s} : never", .{ source_type, member, member, value_name, member });
        }
        if (target.kind == .name) {
            const mods = try self.allocator.alloc([]const u8, 1);
            mods[0] = self.options.kind;
            try self.declarations.append(.{ .kind = .variable_decl, .name = target.name, .text = try std.fmt.allocPrint(self.allocator, "{s}declare {s} {s}: {s};", .{ if (self.options.exported) "export " else "", self.options.kind, target.name, source_type }), .type_annotation = source_type, .preserve_type_annotation = true, .modifiers = mods, .is_exported = self.options.exported, .leading_comments = if (self.commented) null else self.options.comments, .start = self.options.root.start, .end = self.options.root.end });
            self.commented = true;
            return;
        }
        var parameters = std.array_list.Managed([]const u8).init(self.allocator);
        defer parameters.deinit();
        var returns = std.array_list.Managed([]const u8).init(self.allocator);
        defer returns.deinit();
        const Slot = struct { target: *const Target, index: usize };
        var slots = std.array_list.Managed(Slot).init(self.allocator);
        defer slots.deinit();
        for (target.elements) |element| {
            const entry = element orelse {
                try parameters.append("");
                continue;
            };
            const parameter = try self.names.next();
            var key = entry.key;
            if (entry.computed) |computed| key = try std.fmt.allocPrint(self.allocator, "[{s}]", .{try self.value(computed, "const")});
            try parameters.append(if (entry.rest) try std.fmt.allocPrint(self.allocator, "...{s}", .{parameter}) else if (target.kind == .object) try std.fmt.allocPrint(self.allocator, "{s}: {s}", .{ key, parameter }) else parameter);
            try slots.append(.{ .target = entry.target, .index = returns.items.len });
            try returns.append(try std.fmt.allocPrint(self.allocator, "typeof {s}", .{parameter}));
        }
        const function_name = try self.names.next();
        const result_name = try self.names.next();
        const inferred = try self.names.next();
        const parameters_text = try std.mem.join(self.allocator, ", ", parameters.items);
        const returns_text = try std.mem.join(self.allocator, ", ", returns.items);
        const parameter = try std.fmt.allocPrint(self.allocator, "{s}{s}{s}", .{ if (target.kind == .object) "{ " else "[", parameters_text, if (target.kind == .object) " }" else "]" });
        try self.declarations.append(.{ .kind = .function_decl, .name = function_name, .text = try std.fmt.allocPrint(self.allocator, "declare function {s}({s}: {s}): [{s}];", .{ function_name, parameter, source_type, returns_text }), .start = self.options.root.start, .end = self.options.root.end });
        try self.declarations.append(.{ .kind = .type_decl, .name = result_name, .text = try std.fmt.allocPrint(self.allocator, "type {s} = (typeof {s}) extends (...args: never[]) => infer {s} ? {s} : never;", .{ result_name, function_name, inferred, inferred }), .start = self.options.root.start, .end = self.options.root.end });
        for (slots.items) |slot| try self.project(slot.target, try std.fmt.allocPrint(self.allocator, "{s}[{d}]", .{ result_name, slot.index }));
    }
};

pub fn projectBindingPattern(allocator: Allocator, names: *Names, options: Options) ![]Declaration {
    var parser = Parser{ .allocator = allocator, .source = options.pattern, .tokens = try syntax.tokenizeDeclarationSyntax(allocator, options.pattern), .pairs = std.AutoHashMap(usize, usize).init(allocator) };
    defer allocator.free(parser.tokens);
    defer parser.pairs.deinit();
    const target = try parser.parse();
    var bound = std.array_list.Managed([]const u8).init(allocator);
    defer bound.deinit();
    try appendNames(target, &bound);
    if (bound.items.len == 0) return &.{};
    var projector = Projector{ .allocator = allocator, .names = names, .options = options, .declarations = std.array_list.Managed(Declaration).init(allocator) };
    defer projector.declarations.deinit();
    try projector.declarations.append(options.root);
    try projector.project(target, try std.fmt.allocPrint(allocator, "typeof {s}", .{options.root.name}));
    return projector.declarations.toOwnedSlice();
}

const Vector = struct { pattern: []const u8, names: []const []const u8 };

fn checkVectors(allocator: Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const owned = arena.allocator();
    const vectors = try std.json.parseFromSlice([]const Vector, owned, @embedFile("fixtures/binding-patterns.json"), .{});
    for (vectors.value) |vector| {
        const bound = try bindingPatternNames(owned, vector.pattern);
        try std.testing.expectEqual(vector.names.len, bound.len);
        for (vector.names, bound) |expected, actual| try std.testing.expectEqualStrings(expected, actual);
        var counter: usize = 0;
        var names = Names{ .allocator = owned, .source = "const __dtsx_binding_0 = 7;", .counter = &counter };
        const root_name = try names.next();
        try std.testing.expectEqualStrings("__dtsx_binding_1", root_name);
        const projected = try projectBindingPattern(owned, &names, .{ .pattern = vector.pattern, .pattern_offset = 10, .root = .{ .kind = .variable_decl, .name = root_name, .text = "declare const root: unknown;", .start = 0, .end = 100 }, .kind = "const", .exported = true });
        var public: usize = 0;
        for (projected) |declaration| if (declaration.is_exported) {
            try std.testing.expectEqualStrings(vector.names[public], declaration.name);
            public += 1;
        };
        try std.testing.expectEqual(vector.names.len, public);
        if (vector.names.len > 0) try std.testing.expect(!projected[0].is_exported);
    }
}

test "binding projections share the source grammar vectors" {
    try checkVectors(std.testing.allocator);
}

test "binding projections retain backing allocation errors" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkVectors, .{});
}
