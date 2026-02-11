const std = @import("std");

/// Declaration kinds matching the TypeScript scanner output
pub const DeclarationKind = enum {
    import_decl,
    export_decl,
    function_decl,
    variable_decl,
    interface_decl,
    type_decl,
    class_decl,
    enum_decl,
    module_decl,
    namespace_decl,
    unknown_decl,

    pub fn toString(self: DeclarationKind) []const u8 {
        return switch (self) {
            .import_decl => "import",
            .export_decl => "export",
            .function_decl => "function",
            .variable_decl => "variable",
            .interface_decl => "interface",
            .type_decl => "type",
            .class_decl => "class",
            .enum_decl => "enum",
            .module_decl => "module",
            .namespace_decl => "namespace",
            .unknown_decl => "unknown",
        };
    }
};

/// A single declaration extracted from TypeScript source.
/// `text` contains the pre-built DTS output for this declaration.
/// `name_slice` and other slices point into the original source buffer.
pub const Declaration = struct {
    kind: DeclarationKind,
    /// Name of the declaration (slice into source or allocated)
    name: []const u8 = "",
    /// Pre-built DTS text for this declaration (owned, allocated)
    text: []const u8 = "",
    /// Whether this declaration is exported
    is_exported: bool = false,
    /// Whether this is a default export
    is_default: bool = false,
    /// Whether this is type-only (for imports/exports)
    is_type_only: bool = false,
    /// Whether this is a side-effect import
    is_side_effect: bool = false,
    /// Module source for imports (e.g., 'node:fs')
    source_module: []const u8 = "",
    /// Leading comments (JSDoc, block, single-line)
    leading_comments: ?[]const []const u8 = null,
    /// Start position in source
    start: usize = 0,
    /// End position in source
    end: usize = 0,
    /// Whether this function had a body (for overload detection)
    has_body: bool = false,
    /// Initializer text for variable declarations
    value: []const u8 = "",
    /// Type annotation text
    type_annotation: []const u8 = "",
    /// Whether this is async
    is_async: bool = false,
    /// Whether this is a generator
    is_generator: bool = false,
    /// Modifiers like ['const', 'const assertion'], ['abstract']
    modifiers: ?[]const []const u8 = null,
    /// Generics text
    generics: []const u8 = "",
    /// Extends clause
    extends_clause: []const u8 = "",
    /// Implements list
    implements_list: ?[]const []const u8 = null,
};

/// Parsed import statement for filtering/sorting
pub const ParsedImport = struct {
    default_name: ?[]const u8 = null,
    named_items: []const []const u8 = &.{},
    source: []const u8 = "",
    is_type_only: bool = false,
    is_namespace: bool = false,
    namespace_name: ?[]const u8 = null,
};

/// Constructor parameter modifiers (hoisted to avoid per-call allocation)
pub const PARAM_MODIFIERS = [_][]const u8{
    "public",
    "protected",
    "private",
    "readonly",
    "override",
};

test "DeclarationKind toString" {
    try std.testing.expectEqualStrings("function", DeclarationKind.function_decl.toString());
    try std.testing.expectEqualStrings("import", DeclarationKind.import_decl.toString());
}
