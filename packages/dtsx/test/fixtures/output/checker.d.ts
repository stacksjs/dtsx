import { __String, and, Decorator, DiagnosticWithLocation, ExportAssignment, ExportSpecifier, Identifier, ModuleDeclaration, Node, not, or, PropertyAssignment, Signature, some, Symbol, SymbolId, Type, TypeChecker, TypeCheckerHost } from './_namespaces/ts.js';
/** @internal */
export declare function getNodeId(node: Node): number;
/** @internal */
export declare function getSymbolId(symbol: Symbol): SymbolId;
/** @internal */
export declare function isInstantiatedModule(node: ModuleDeclaration, preserveConstEnums: boolean): boolean;
/** @internal */
export declare function createTypeChecker(host: TypeCheckerHost): TypeChecker;
/** @internal */
export declare function signatureHasRestParameter(s: Signature): boolean;
/** @internal */
export declare function signatureHasLiteralTypes(s: Signature): boolean;
declare type TypeSystemEntity = Node | Symbol | Type | Signature;
/** @param containingNode Node to check for parse error */
declare type AddUnusedDiagnostic = (containingNode: Node, type: UnusedKind, diagnostic: DiagnosticWithLocation) => void;
declare const enum ReferenceHint {
    Unspecified = 0,
    Identifier = 1,
    Property = 2,
    ExportAssignment = 3,
    Jsx = 4,
    AsyncFunction = 5,
    ExportImportEquals = 6,
    ExportSpecifier = 7,
    Decorator = 8,
}
declare const enum IterationUse {
    AllowsSyncIterablesFlag = 1,
    AllowsAsyncIterablesFlag = 2,
    AllowsStringInputFlag = 4,
    ForOfFlag = 8,
    YieldStarFlag = 16,
    SpreadFlag = 32,
    DestructuringFlag = 64,
    PossiblyOutOfBounds = 128,

    // Spread, Destructuring, Array element assignment
    Element = 1,
    Spread = 33,
    Destructuring = 65,

    ForOf = 13,
    ForAwaitOf = 15,

    YieldStar = 17,
    AsyncYieldStar = 19,

    GeneratorReturnType = 1,
    AsyncGeneratorReturnType = 2,
}
declare const enum IterationTypeKind {
    Yield = 0,
    Return = 1,
    Next = 2,
}
declare const enum WideningKind {
    Normal = 0,
    FunctionReturn = 1,
    GeneratorNext = 2,
    GeneratorYield = 3,
}
/** @internal */
export declare const enum TypeFacts {
    None = 0,
    TypeofEQString = 1,      // typeof x === "string"
    TypeofEQNumber = 2,      // typeof x === "number"
    TypeofEQBigInt = 4,      // typeof x === "bigint"
    TypeofEQBoolean = 8,     // typeof x === "boolean"
    TypeofEQSymbol = 16,      // typeof x === "symbol"
    TypeofEQObject = 32,      // typeof x === "object"
    TypeofEQFunction = 64,    // typeof x === "function"
    TypeofEQHostObject = 128,  // typeof x === "xxx"
    TypeofNEString = 256,      // typeof x !== "string"
    TypeofNENumber = 512,      // typeof x !== "number"
    TypeofNEBigInt = 1024,     // typeof x !== "bigint"
    TypeofNEBoolean = 2048,    // typeof x !== "boolean"
    TypeofNESymbol = 4096,     // typeof x !== "symbol"
    TypeofNEObject = 8192,     // typeof x !== "object"
    TypeofNEFunction = 16384,   // typeof x !== "function"
    TypeofNEHostObject = 32768, // typeof x !== "xxx"
    EQUndefined = 65536,        // x === undefined
    EQNull = 131072,             // x === null
    EQUndefinedOrNull = 262144,  // x === undefined / x === null
    NEUndefined = 524288,        // x !== undefined
    NENull = 1048576,             // x !== null
    NEUndefinedOrNull = 2097152,  // x != undefined / x != null
    Truthy = 4194304,             // x
    Falsy = 8388608,              // !x
    IsUndefined = 16777216,        // Contains undefined or intersection with undefined
    IsNull = 33554432,             // Contains null or intersection with null
    IsUndefinedOrNull = 50331648,
    All = 134217727,
    // The following members encode facts about particular kinds of types for use in the getTypeFacts function.
    // The presence of a particular fact means that the given test is true for some (and possibly all) values
    // of that kind of type.
    BaseStringStrictFacts = 3735041,
    BaseStringFacts = 12582401,
    StringStrictFacts = 16317953,
    StringFacts = 16776705,
    EmptyStringStrictFacts = 12123649,
    EmptyStringFacts = 12582401,
    NonEmptyStringStrictFacts = 7929345,
    NonEmptyStringFacts = 16776705,
    BaseNumberStrictFacts = 3734786,
    BaseNumberFacts = 12582146,
    NumberStrictFacts = 16317698,
    NumberFacts = 16776450,
    ZeroNumberStrictFacts = 12123394,
    ZeroNumberFacts = 12582146,
    NonZeroNumberStrictFacts = 7929090,
    NonZeroNumberFacts = 16776450,
    BaseBigIntStrictFacts = 3734276,
    BaseBigIntFacts = 12581636,
    BigIntStrictFacts = 16317188,
    BigIntFacts = 16775940,
    ZeroBigIntStrictFacts = 12122884,
    ZeroBigIntFacts = 12581636,
    NonZeroBigIntStrictFacts = 7928580,
    NonZeroBigIntFacts = 16775940,
    BaseBooleanStrictFacts = 3733256,
    BaseBooleanFacts = 12580616,
    BooleanStrictFacts = 16316168,
    BooleanFacts = 16774920,
    FalseStrictFacts = 12121864,
    FalseFacts = 12580616,
    TrueStrictFacts = 7927560,
    TrueFacts = 16774920,
    SymbolStrictFacts = 7925520,
    SymbolFacts = 16772880,
    ObjectStrictFacts = 7888800,
    ObjectFacts = 16736160,
    FunctionStrictFacts = 7880640,
    FunctionFacts = 16728000,
    VoidFacts = 9830144,
    UndefinedFacts = 26607360,
    NullFacts = 42917664,
    EmptyObjectStrictFacts = 83427327,
    EmptyObjectFacts = 83886079,
    UnknownFacts = 83886079,
    AllTypeofNE = 556800,
    // Masks
    OrFactsMask = 8256,
    AndFactsMask = 134209471,
}
declare const enum TypeSystemPropertyName {
    Type = 0,
    ResolvedBaseConstructorType = 1,
    DeclaredType = 2,
    ResolvedReturnType = 3,
    ImmediateBaseConstraint = 4,
    ResolvedTypeArguments = 5,
    ResolvedBaseTypes = 6,
    WriteType = 7,
    ParameterInitializerContainsUndefined = 8,
}
/** @internal */
export declare const enum CheckMode {
    Normal = 0,                                     // Normal type checking
    Contextual = 1,                            // Explicitly assigned contextual type, therefore not cacheable
    Inferential = 2,                           // Inferential typing
    SkipContextSensitive = 4,                  // Skip context sensitive function expressions
    SkipGenericFunctions = 8,                  // Skip single signature generic functions
    IsForSignatureHelp = 16,                    // Call resolution for purposes of signature help
    RestBindingElement = 32,                    // Checking a type that is going to be used to determine the type of a rest binding element
                                                    //   e.g. in `const { a, ...rest } = foo`, when checking the type of `foo` to determine the type of `rest`,
                                                    //   we need to preserve generic types instead of substituting them for constraints
    TypeOnly = 64,                              // Called from getTypeOfExpression, diagnostics may be omitted
}
/** @internal */
export declare const enum SignatureCheckMode {
    None = 0,
    BivariantCallback = 1,
    StrictCallback = 2,
    IgnoreReturnTypes = 4,
    StrictArity = 8,
    StrictTopSignature = 16,
    Callback = 3,
}
declare const enum IntersectionState {
    None = 0,
    Source = 1, // Source type is a constituent of an outer intersection
    Target = 2, // Target type is a constituent of an outer intersection
}
declare const enum RecursionFlags {
    None = 0,
    Source = 1,
    Target = 2,
    Both = 3,
}
declare const enum MappedTypeModifiers {
    IncludeReadonly = 1,
    ExcludeReadonly = 2,
    IncludeOptional = 4,
    ExcludeOptional = 8,
}
declare const enum MappedTypeNameTypeKind {
    None = 0,
    Filtering = 1,
    Remapping = 2,
}
declare const enum ExpandingFlags {
    None = 0,
    Source = 1,
    Target = 2,
    Both = 3,
}
declare const enum MembersOrExportsResolutionKind {
    resolvedExports = 'resolvedExports',
    resolvedMembers = 'resolvedMembers',
}
declare const enum UnusedKind {
    Local = 0,
    Parameter = 1,
}
declare const enum DeclarationMeaning {
    GetAccessor = 1,
    SetAccessor = 2,
    PropertyAssignment = 4,
    Method = 8,
    PrivateStatic = 16,
    GetOrSetAccessor = 3,
    PropertyAssignmentOrMethod = 12,
}
declare const enum DeclarationSpaces {
    None = 0,
    ExportValue = 1,
    ExportType = 2,
    ExportNamespace = 4,
}
declare const enum MinArgumentCountFlags {
    None = 0,
    StrongArityForUntypedJS = 1,
    VoidIsNonOptional = 2,
}
declare const enum IntrinsicTypeKind {
    Uppercase = 0,
    Lowercase = 1,
    Capitalize = 2,
    Uncapitalize = 3,
    NoInfer = 4,
}
declare namespace JsxNames {
  export const JSX: __String;
  export const IntrinsicElements: __String;
  export const ElementClass: __String;
  export const ElementAttributesPropertyNameContainer: __String;
  export const ElementChildrenAttributeNameContainer: __String;
  export const Element: __String;
  export const ElementType: __String;
  export const IntrinsicAttributes: __String;
  export const IntrinsicClassAttributes: __String;
  export const LibraryManagedAttributes: __String;
}
export {};
