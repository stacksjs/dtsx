//! Value references of private function candidates, separate from type names.
const std = @import("std");
const binding_patterns = @import("binding_patterns.zig");
const syntax = @import("module_specifiers.zig");
const Declaration = @import("types.zig").Declaration;
const Token = syntax.SyntaxToken;

pub fn directConstValueAlias(allocator: std.mem.Allocator, value: []const u8) !?[]const u8 {
    // Without a `/` there are no comments, so the value is one word token
    // exactly when its trimmed text is a single identifier; skip tokenizing.
    if (std.mem.indexOfScalar(u8, value, '/') == null) {
        const trimmed = std.mem.trim(u8, value, " \t\n\r");
        if (trimmed.len == 0 or !syntax.ident_start_table[trimmed[0]]) return null;
        for (trimmed[1..]) |c| if (!syntax.ident_char_table[c]) return null;
        return if (oneOf(trimmed, &.{ "true", "false", "null", "undefined", "this", "super" })) null else trimmed;
    }
    const items = try syntax.tokenizeDeclarationSyntax(allocator, value);
    defer allocator.free(items);
    if (items.len != 1 or items[0].kind != .word) return null;
    const name = value[items[0].start..items[0].end];
    return if (oneOf(name, &.{ "true", "false", "null", "undefined", "this", "super" })) null else name;
}

pub fn returnTypeExpectsObject(allocator: std.mem.Allocator, prefix: []const u8) syntax.SyntaxError!bool {
    const items = try syntax.tokenizeDeclarationSyntax(allocator, prefix);
    defer allocator.free(items);
    if (items.len == 0) return true;
    const last = text(prefix, items, items.len - 1);
    if (items[items.len - 1].kind == .word and oneOf(last, &.{ "is", "extends", "keyof", "readonly" })) return true;
    return oneOf(last, &.{ "|", "&", "?", ":" }) or (std.mem.eql(u8, last, ">") and items.len >= 2 and eq(prefix, items, items.len - 2, "="));
}

fn text(source: []const u8, items: []const Token, index: usize) []const u8 {
    return if (index < items.len) source[items[index].start..items[index].end] else "";
}

fn eq(source: []const u8, items: []const Token, index: usize, value: []const u8) bool {
    return std.mem.eql(u8, text(source, items, index), value);
}

/// A source is an external module when a top-level `export`, or an `import`
/// that is not `import(...)`/`import.meta`, appears outside any bracket. This
/// streams tokens instead of materializing them: the whole source is still
/// lexed so malformed literals are reported exactly as before.
pub fn isExternalModuleSource(allocator: std.mem.Allocator, source: []const u8) !bool {
    var detector = ExternalModuleDetector{ .source = source };
    syntax.visitDeclarationSyntax(allocator, source, &detector) catch |err| switch (err) {
        error.StopVisit => unreachable, // stop_when_found is false
        else => |e| return e,
    };
    // `import` as the final token is followed by nothing, which is neither
    // `(` nor `.`, so it marks a module.
    return detector.found or detector.pending_import;
}

/// Module detection for text this emitter generated itself (already derived
/// from a lexically validated source): stop at the first top-level
/// import/export instead of lexing the remainder. Lexical errors met before
/// that point still propagate, as with isExternalModuleSource.
pub fn emittedTextIsExternalModule(allocator: std.mem.Allocator, text_value: []const u8) syntax.SyntaxError!bool {
    var detector = ExternalModuleDetector{ .source = text_value };
    syntax.visitDeclarationSyntax(allocator, text_value, StopOnModule{ .detector = &detector }) catch |err| switch (err) {
        error.StopVisit => return true,
        else => |e| return e,
    };
    return detector.found or detector.pending_import;
}

const StopOnModule = struct {
    detector: *ExternalModuleDetector,
    pub fn push(self: StopOnModule, token: Token) syntax.VisitError!void {
        try self.detector.push(token);
        if (self.detector.found) return error.StopVisit;
    }
};

/// isExternalModuleSource over already-lexed tokens of `source`.
pub fn isExternalModuleTokens(source: []const u8, items: []const Token) bool {
    var detector = ExternalModuleDetector{ .source = source };
    for (items) |token| {
        detector.push(token) catch unreachable;
        if (detector.found) return true;
    }
    return detector.pending_import;
}

const ExternalModuleDetector = struct {
    source: []const u8,
    depth: usize = 0,
    pending_import: bool = false,
    found: bool = false,

    pub fn push(self: *ExternalModuleDetector, token: Token) syntax.VisitError!void {
        if (self.found) return;
        const value = self.source[token.start..token.end];
        if (self.pending_import) {
            self.pending_import = false;
            if (!(token.kind == .punctuation and (value[0] == '(' or value[0] == '.'))) {
                self.found = true;
                return;
            }
        }
        if (token.kind == .word) {
            if (self.depth == 0) {
                if (std.mem.eql(u8, value, "export")) {
                    self.found = true;
                } else if (std.mem.eql(u8, value, "import")) {
                    self.pending_import = true;
                }
            }
        } else if (token.kind == .punctuation) {
            switch (value[0]) {
                '{', '(', '[' => self.depth += 1,
                '}', ')', ']' => self.depth -|= 1,
                else => {},
            }
        }
    }
};

pub fn isPrivateImportableDeclaration(declaration: Declaration) bool {
    if (declaration.is_exported) return false;
    return switch (declaration.kind) {
        .function_decl, .variable_decl, .interface_decl, .type_decl, .class_decl, .enum_decl, .namespace_decl => true,
        .module_decl => declaration.module_form == .namespace or declaration.module_form == .identifier,
        else => false,
    };
}

const Scope = struct { start: usize, end: usize, names: std.StringHashMap(void) };

fn addReference(source: []const u8, items: []const Token, index: usize, scopes: []const Scope, references: *std.StringHashMap(void), positions: ?*std.AutoHashMap(usize, void)) !void {
    if (index >= items.len or items[index].kind != .word) return;
    const name = text(source, items, index);
    if (positions) |found| try found.put(items[index].start, {});
    for (scopes) |scope| {
        if (index >= scope.start and index < scope.end and scope.names.contains(name)) return;
    }
    try references.put(name, {});
}

fn oneOf(value: []const u8, values: []const []const u8) bool {
    for (values) |candidate| if (std.mem.eql(u8, value, candidate)) return true;
    return false;
}

/// Matching bracket index for each opening token, or `none`. A flat array
/// replaces a hash map: every lookup is a direct index on the token list.
const Pairs = struct {
    const none = std.math.maxInt(usize);
    close: []usize,

    fn get(self: Pairs, index: usize) ?usize {
        if (index >= self.close.len) return null;
        const value = self.close[index];
        return if (value == none) null else value;
    }
};

/// Punctuation tokens are always one byte, so comparing that byte is
/// equivalent to comparing the token text with a one-character string.
inline fn isPunct(source: []const u8, items: []const Token, index: usize, c: u8) bool {
    return index < items.len and items[index].kind == .punctuation and source[items[index].start] == c;
}

inline fn isWord(source: []const u8, items: []const Token, index: usize, value: []const u8) bool {
    return index < items.len and items[index].kind == .word and std.mem.eql(u8, source[items[index].start..items[index].end], value);
}

fn expressionReferences(source: []const u8, items: []const Token, start: usize, end: usize, pairs: Pairs, scopes: []const Scope, references: *std.StringHashMap(void), positions: ?*std.AutoHashMap(usize, void)) !void {
    var i = start;
    while (i < end) : (i += 1) {
        if (isPunct(source, items, i, '<')) {
            if (pairs.get(i)) |close| {
                i = close;
                continue;
            }
        }
        if (items[i].kind != .word or (i > 0 and isPunct(source, items, i - 1, '.')) or isPunct(source, items, i + 1, ':')) continue;
        if (oneOf(text(source, items, i), &.{ "true", "false", "null", "undefined", "new", "this", "super", "as", "satisfies", "typeof", "void", "keyof" })) continue;
        try addReference(source, items, i, scopes, references, positions);
    }
}

fn memberHeader(source: []const u8, items: []const Token, pairs: Pairs, start: usize) bool {
    var label = start;
    while (oneOf(text(source, items, label), &.{ "readonly", "public", "private", "protected", "static", "abstract", "override", "declare", "accessor", "get", "set", "async" }) and
        label + 1 < items.len and (items[label + 1].kind == .word or items[label + 1].kind == .quoted or isPunct(source, items, label + 1, '[') or (source[items[label + 1].start] >= '0' and source[items[label + 1].start] <= '9'))) label += 1;
    if (isPunct(source, items, label, '(')) return isPunct(source, items, (pairs.get(label) orelse return false) + 1, ':');
    if (isPunct(source, items, label, '<')) return isPunct(source, items, (pairs.get(label) orelse return false) + 1, '(');
    var after = label + 1;
    if (isPunct(source, items, label, '[')) {
        after = (pairs.get(label) orelse return false) + 1;
    } else if (label < items.len and source[items[label].start] >= '0' and source[items[label].start] <= '9') {
        while (after < items.len and items[after - 1].end == items[after].start and numericPropertyToken(text(source, items, after))) after += 1;
    } else if (label >= items.len or (items[label].kind != .word and items[label].kind != .quoted and items[label].kind != .template)) return false;
    if (isPunct(source, items, after, '?')) after += 1;
    if (isPunct(source, items, after, '<')) after = (pairs.get(after) orelse return false) + 1;
    return isPunct(source, items, after, ':') or isPunct(source, items, after, '(');
}

fn numericPropertyToken(value: []const u8) bool {
    if (value.len == 0) return false;
    for (value) |c| {
        if (std.mem.indexOfScalar(u8, "0123456789abcdefABCDEFxXoObB_eE.+-", c) == null) return false;
    }
    return true;
}

pub const TypeReferences = struct { candidates: *const std.StringHashMap(Declaration), references: *std.StringHashMap(void) };

pub fn collectValueReferences(allocator: std.mem.Allocator, declaration: Declaration, references: *std.StringHashMap(void)) !void {
    return collectReferences(allocator, declaration, references, null);
}

pub fn collectReferences(allocator: std.mem.Allocator, declaration: Declaration, references: *std.StringHashMap(void), type_references: ?TypeReferences) !void {
    var value_positions = std.AutoHashMap(usize, void).init(allocator);
    defer value_positions.deinit();
    const positions = if (type_references != null) &value_positions else null;
    const source = declaration.text;
    const items = try syntax.tokenizeDeclarationSyntax(allocator, source);
    defer allocator.free(items);
    const pairs = Pairs{ .close = try allocator.alloc(usize, items.len) };
    defer allocator.free(pairs.close);
    @memset(pairs.close, Pairs.none);
    var generic_openings = std.AutoHashMap(usize, usize).init(allocator);
    defer generic_openings.deinit();
    var stack = std.array_list.Managed(usize).init(allocator);
    defer stack.deinit();
    for (items, 0..) |token, i| {
        if (token.kind != .punctuation) continue;
        const c = source[token.start];
        switch (c) {
            '(', '[', '{', '<' => try stack.append(i),
            ')', ']', '}', '>' => {
                if (c == '>' and isPunct(source, items, i -| 1, '=')) continue;
                if (stack.items.len == 0) continue;
                const open = stack.items[stack.items.len - 1];
                const opener = source[items[open].start];
                if ((opener == '(' and c == ')') or (opener == '[' and c == ']') or
                    (opener == '{' and c == '}') or (opener == '<' and c == '>'))
                {
                    _ = stack.pop();
                    pairs.close[open] = i;
                    if (opener == '<') try generic_openings.put(i, open);
                }
            },
            else => {},
        }
    }

    var generic_scopes = std.array_list.Managed(Scope).init(allocator);
    defer {
        for (generic_scopes.items) |*scope| scope.names.deinit();
        generic_scopes.deinit();
    }
    var scopes = std.array_list.Managed(Scope).init(allocator);
    defer {
        for (scopes.items) |*scope| scope.names.deinit();
        scopes.deinit();
    }
    for (items, 0..) |_, open| {
        if (!isPunct(source, items, open, '(')) continue;
        const close = pairs.get(open) orelse continue;
        if (!isPunct(source, items, close + 1, ':') and !(isPunct(source, items, close + 1, '=') and isPunct(source, items, close + 2, '>'))) continue;
        var names = std.StringHashMap(void).init(allocator);
        errdefer names.deinit();
        var parameter = open + 1;
        while (parameter < close) {
            var end = parameter;
            while (end < close and !isPunct(source, items, end, ',')) {
                end = if (pairs.get(end)) |nested| nested + 1 else end + 1;
            }
            var binding_end = parameter;
            while (binding_end < end and !isPunct(source, items, binding_end, ':') and !isPunct(source, items, binding_end, '=')) {
                binding_end = if (pairs.get(binding_end)) |nested| nested + 1 else binding_end + 1;
            }
            var first = parameter;
            while (oneOf(text(source, items, first), &.{ ".", "public", "private", "protected", "readonly", "override" })) first += 1;
            if (isPunct(source, items, first, '{') or isPunct(source, items, first, '[')) {
                const bound = try binding_patterns.bindingPatternNames(allocator, source[items[first].start..items[binding_end - 1].end]);
                defer allocator.free(bound);
                for (bound) |name| try names.put(name, {});
            } else if (first < items.len and items[first].kind == .word) try names.put(text(source, items, first), {});
            parameter = end + 1;
        }
        var end = close + @as(usize, if (isPunct(source, items, close + 1, ':')) 2 else 3);
        while (end < items.len) {
            if (end > close + 2 and std.mem.indexOfScalar(u8, source[items[end - 1].end..items[end].start], '\n') != null and
                !oneOf(text(source, items, end - 1), &.{ "|", "&", "?", "extends", "keyof", "typeof", "readonly", "new", "infer", "is" }))
            {
                if (memberHeader(source, items, pairs, end)) break;
            }
            if (items[end].kind == .punctuation) {
                const c = source[items[end].start];
                if (c == ';' or c == ',' or c == ')' or c == ']' or c == '}' or
                    (c == '>' and !isPunct(source, items, end -| 1, '='))) break;
            }
            end = if (pairs.get(end)) |nested| nested + 1 else end + 1;
        }
        if (type_references != null and open > 0) {
            if (generic_openings.get(open - 1)) |generic_open| {
                var generic_names = std.StringHashMap(void).init(allocator);
                errdefer generic_names.deinit();
                var generic_parameter = generic_open + 1;
                while (generic_parameter < open - 1) {
                    while (oneOf(text(source, items, generic_parameter), &.{ "const", "in", "out" })) generic_parameter += 1;
                    if (generic_parameter < items.len and items[generic_parameter].kind == .word) try generic_names.put(text(source, items, generic_parameter), {});
                    while (generic_parameter < open - 1 and !isPunct(source, items, generic_parameter, ',')) {
                        generic_parameter = if (pairs.get(generic_parameter)) |nested| nested + 1 else generic_parameter + 1;
                    }
                    generic_parameter += 1;
                }
                try generic_scopes.append(.{ .start = generic_open, .end = end, .names = generic_names });
            }
        }
        try scopes.append(.{ .start = open, .end = end, .names = names });
    }

    for (items, 0..) |token, i| {
        if (token.kind == .word) {
            const word = source[token.start..token.end];
            if (std.mem.eql(u8, word, "typeof")) {
                try addReference(source, items, i + 1, scopes.items, references, positions);
            } else if (std.mem.eql(u8, word, "export")) {
                var next = i + 1;
                if (isWord(source, items, next, "default")) {
                    if (!oneOf(text(source, items, next + 1), &.{ "function", "class", "abstract" })) {
                        try expressionReferences(source, items, next + 1, items.len, pairs, scopes.items, references, positions);
                        if (type_references) |types| {
                            if (types.candidates.contains(text(source, items, next + 1)) and (next + 2 == items.len or isPunct(source, items, next + 2, ';')))
                                try types.references.put(text(source, items, next + 1), {});
                        }
                    }
                    continue;
                }
                const type_only = isWord(source, items, next, "type");
                if (type_only) next += 1;
                if (isPunct(source, items, next, '{')) {
                    const close = pairs.get(next) orelse continue;
                    if (isWord(source, items, close + 1, "from")) continue;
                    var item = next + 1;
                    while (item < close) {
                        const inline_type = isWord(source, items, item, "type") and item + 1 < items.len and items[item + 1].kind == .word and !isWord(source, items, item + 1, "as");
                        if (inline_type) item += 1;
                        const has_type = if (type_references) |types| types.candidates.contains(text(source, items, item)) else false;
                        if (has_type) try type_references.?.references.put(text(source, items, item), {});
                        if (!has_type or (!type_only and !inline_type)) {
                            try addReference(source, items, item, scopes.items, references, positions);
                        } else if (positions) |found| try found.put(items[item].start, {});
                        while (item < close and !isPunct(source, items, item, ',')) item += 1;
                        item += 1;
                    }
                }
            }
        } else if (token.kind == .punctuation and source[token.start] == '[') {
            if (pairs.get(i)) |close| {
                const after_close = isPunct(source, items, close + 1, ':') or isPunct(source, items, close + 1, '?') or isPunct(source, items, close + 1, '(');
                if (after_close and !isPunct(source, items, i + 2, ':') and !isWord(source, items, i + 2, "in"))
                    try expressionReferences(source, items, i + 1, close, pairs, scopes.items, references, positions);
            }
        }
    }
    if (declaration.kind == .class_decl) {
        var i: usize = 0;
        while (i < items.len and !isPunct(source, items, i, '{')) : (i += 1) {
            if (isPunct(source, items, i, '<')) {
                if (pairs.get(i)) |close| {
                    i = close;
                    continue;
                }
            }
            if (!isWord(source, items, i, "extends")) continue;
            var end = i + 1;
            while (end < items.len and !isPunct(source, items, end, '{') and !isWord(source, items, end, "implements")) {
                end = if (pairs.get(end)) |nested| nested + 1 else end + 1;
            }
            try expressionReferences(source, items, i + 1, end, pairs, scopes.items, references, positions);
            break;
        }
    }
    if (type_references) |types| {
        var generic_names = std.StringHashMap(void).init(allocator);
        defer generic_names.deinit();
        const generic_tokens = try syntax.tokenizeDeclarationSyntax(allocator, declaration.generics);
        defer allocator.free(generic_tokens);
        var depth: usize = 0;
        var parameter = false;
        for (generic_tokens) |token| {
            const value = declaration.generics[token.start..token.end];
            if (oneOf(value, &.{ "<", "(", "[", "{" })) {
                depth += 1;
                if (std.mem.eql(u8, value, "<") and depth == 1) parameter = true;
            } else if (oneOf(value, &.{ ">", ")", "]", "}" }) and !(std.mem.eql(u8, value, ">") and token.start > 0 and declaration.generics[token.start - 1] == '=')) {
                depth -|= 1;
            } else if (std.mem.eql(u8, value, ",") and depth == 1) {
                parameter = true;
            } else if (parameter and depth == 1 and token.kind == .word and !oneOf(value, &.{ "const", "in", "out" })) {
                try generic_names.put(value, {});
                parameter = false;
            }
        }
        const Event = struct { index: usize, name: []const u8, delta: i64 };
        var events = std.array_list.Managed(Event).init(allocator);
        defer events.deinit();
        for (generic_scopes.items) |scope| {
            var names = scope.names.keyIterator();
            while (names.next()) |name| {
                try events.append(.{ .index = scope.start, .name = name.*, .delta = 1 });
                try events.append(.{ .index = scope.end, .name = name.*, .delta = -1 });
            }
        }
        std.mem.sort(Event, events.items, {}, struct {
            fn less(_: void, left: Event, right: Event) bool {
                return left.index < right.index;
            }
        }.less);
        var active = std.StringHashMap(i64).init(allocator);
        defer active.deinit();
        var event: usize = 0;
        for (items, 0..) |token, i| {
            while (event < events.items.len and events.items[event].index <= i) : (event += 1) {
                const entry = events.items[event];
                const binding = try active.getOrPut(entry.name);
                if (!binding.found_existing) binding.value_ptr.* = 0;
                binding.value_ptr.* += entry.delta;
            }
            if (token.kind != .word or value_positions.contains(token.start)) continue;
            const name = source[token.start..token.end];
            if (!types.candidates.contains(name) or generic_names.contains(name) or (active.get(name) orelse 0) > 0) continue;
            const before = if (i > 0) text(source, items, i - 1) else "";
            const after = text(source, items, i + 1);
            if (std.mem.eql(u8, before, "as") and declaration.kind == .export_decl) continue;
            if (oneOf(before, &.{ ".", "const", "let", "var", "function", "class", "interface", "type", "enum", "namespace", "module" })) continue;
            if ((std.mem.eql(u8, after, ":") and !std.mem.eql(u8, before, "?")) or (std.mem.eql(u8, after, "?") and isPunct(source, items, i + 2, ':'))) continue;
            if (std.mem.eql(u8, after, "(") or (std.mem.eql(u8, after, "?") and isPunct(source, items, i + 2, '('))) continue;
            if (std.mem.eql(u8, after, "<")) {
                if (pairs.get(i + 1)) |close| {
                    if (isPunct(source, items, close + 1, '(')) continue;
                }
            }
            try types.references.put(name, {});
        }
    }
}

test "computed parameter keys remain free while binding targets are scoped" {
    var references = std.StringHashMap(void).init(std.testing.allocator);
    defer references.deinit();
    try collectValueReferences(std.testing.allocator, .{ .kind = .function_decl, .name = "read", .text = "declare function read({ [key]: localValue }: { [key]: number }): [typeof localValue, typeof key];" }, &references);
    try std.testing.expect(references.contains("key"));
    try std.testing.expect(!references.contains("localValue"));
}
