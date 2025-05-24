import { and, Decorator, DiagnosticWithLocation, ExportAssignment, ExportSpecifier, Identifier, ModuleDeclaration, ModuleSpecifierResolutionHost, Node, NodeBuilderFlags, not, or, PropertyAssignment, ReverseMappedSymbol, Signature, some, SourceFile, Symbol, SymbolFlags, SymbolId, SymbolTracker, TrackedSymbol, Type, TypeChecker, TypeCheckerHost, TypeId, TypeMapper, TypeParameter,  } from './_namespaces/ts.js';
export declare function getNodeId(node: Node): number;
export declare function getSymbolId(symbol: Symbol): SymbolId;
export declare function isInstantiatedModule(node: ModuleDeclaration, preserveConstEnums: boolean): void;
export declare function createTypeChecker(host: TypeCheckerHost): TypeChecker;
export declare function signatureHasRestParameter(s: Signature): void;
export declare function signatureHasLiteralTypes(s: Signature): void;
declare interface NodeBuilderContext {
  enclosingDeclaration: Node | undefined
  enclosingFile: SourceFile | undefined
  flags: NodeBuilderFlags
  tracker: SymbolTrackerImpl
  encounteredError: boolean
  reportedDiagnostic: boolean
  trackedSymbols: TrackedSymbol[] | undefined
  visitedTypes: Set<number> | undefined
  symbolDepth: Map<string, number> | undefined
  inferTypeParameters: TypeParameter[] | undefined
  approximateLength: number
  truncating: boolean
  mustCreateTypeParameterSymbolList: boolean
  typeParameterSymbolList: Set<number> | undefined
  mustCreateTypeParametersNamesLookups: boolean
  typeParameterNames: Map<TypeId, Identifier> | undefined
  typeParameterNamesByText: Set<string> | undefined
  typeParameterNamesByTextNextNameCount: Map<string, number> | undefined
  usedSymbolNames: Set<string> | undefined
  remappedSymbolNames: Map<SymbolId, string> | undefined
  remappedSymbolReferences: Map<SymbolId, Symbol> | undefined
  reverseMappedStack: ReverseMappedSymbol[] | undefined
  bundled: boolean
  mapper: TypeMapper | undefined
}
declare type TypeSystemEntity = Node | Symbol | Type | Signature
declare type AddUnusedDiagnostic = (containingNode: Node, type: UnusedKind, diagnostic: DiagnosticWithLocation) => void
declare class SymbolTrackerImpl implements SymbolTracker {
  moduleResolverHost: ModuleSpecifierResolutionHost & { getCommonSourceDirectory(): string; } | undefined;
  context: NodeBuilderContext;
  readonly inner: SymbolTracker | undefined;
  readonly canTrackSymbol: boolean;
  disableTrackSymbol: any;
  constructor(context: NodeBuilderContext, tracker: SymbolTracker | undefined, moduleResolverHost: ModuleSpecifierResolutionHost & { getCommonSourceDirectory(): string; } | undefined);
  trackSymbol(symbol: Symbol, enclosingDeclaration: Node | undefined, meaning: SymbolFlags): boolean;
  reportInaccessibleThisError(): void;
  reportPrivateInBaseOfClassExpression(propertyName: string): void;
  reportInaccessibleUniqueSymbolError(): void;
  reportCyclicStructureError(): void;
  reportLikelyUnsafeImportRequiredError(specifier: string): void;
  reportTruncationError(): void;
  reportNonlocalAugmentation(containingFile: SourceFile, parentSymbol: Symbol, augmentingSymbol: Symbol): void;
  reportNonSerializableProperty(propertyName: string): void;
  private onDiagnosticReported(): void;
  reportInferenceFallback(node: Node): void;
}
declare const enum ReferenceHint {
    Unspecified,
    Identifier,
    Property,
    ExportAssignment,
    Jsx,
    AsyncFunction,
    ExportImportEquals,
    ExportSpecifier,
    Decorator,
}
declare const enum IterationUse {
    AllowsSyncIterablesFlag = 1 << 0,
    AllowsAsyncIterablesFlag = 1 << 1,
    AllowsStringInputFlag = 1 << 2,
    ForOfFlag = 1 << 3,
    YieldStarFlag = 1 << 4,
    SpreadFlag = 1 << 5,
    DestructuringFlag = 1 << 6,
    PossiblyOutOfBounds = 1 << 7,

    // Spread, Destructuring, Array element assignment
    Element = AllowsSyncIterablesFlag,
    Spread = AllowsSyncIterablesFlag | SpreadFlag,
    Destructuring = AllowsSyncIterablesFlag | DestructuringFlag,

    ForOf = AllowsSyncIterablesFlag | AllowsStringInputFlag | ForOfFlag,
    ForAwaitOf = AllowsSyncIterablesFlag | AllowsAsyncIterablesFlag | AllowsStringInputFlag | ForOfFlag,

    YieldStar = AllowsSyncIterablesFlag | YieldStarFlag,
    AsyncYieldStar = AllowsSyncIterablesFlag | AllowsAsyncIterablesFlag | YieldStarFlag,

    GeneratorReturnType = AllowsSyncIterablesFlag,
    AsyncGeneratorReturnType = AllowsAsyncIterablesFlag,
}
declare const enum IterationTypeKind {
    Yield,
    Return,
    Next,
}
declare const enum WideningKind {
    Normal,
    FunctionReturn,
    GeneratorNext,
    GeneratorYield,
}
export declare const enum TypeFacts {
    None = 0,
    TypeofEQString = 1 << 0,      // typeof x === "string"
    TypeofEQNumber = 1 << 1,      // typeof x === "number"
    TypeofEQBigInt = 1 << 2,      // typeof x === "bigint"
    TypeofEQBoolean = 1 << 3,     // typeof x === "boolean"
    TypeofEQSymbol = 1 << 4,      // typeof x === "symbol"
    TypeofEQObject = 1 << 5,      // typeof x === "object"
    TypeofEQFunction = 1 << 6,    // typeof x === "function"
    TypeofEQHostObject = 1 << 7,  // typeof x === "xxx"
    TypeofNEString = 1 << 8,      // typeof x !== "string"
    TypeofNENumber = 1 << 9,      // typeof x !== "number"
    TypeofNEBigInt = 1 << 10,     // typeof x !== "bigint"
    TypeofNEBoolean = 1 << 11,    // typeof x !== "boolean"
    TypeofNESymbol = 1 << 12,     // typeof x !== "symbol"
    TypeofNEObject = 1 << 13,     // typeof x !== "object"
    TypeofNEFunction = 1 << 14,   // typeof x !== "function"
    TypeofNEHostObject = 1 << 15, // typeof x !== "xxx"
    EQUndefined = 1 << 16,        // x === undefined
    EQNull = 1 << 17,             // x === null
    EQUndefinedOrNull = 1 << 18,  // x === undefined / x === null
    NEUndefined = 1 << 19,        // x !== undefined
    NENull = 1 << 20,             // x !== null
    NEUndefinedOrNull = 1 << 21,  // x != undefined / x != null
    Truthy = 1 << 22,             // x
    Falsy = 1 << 23,              // !x
    IsUndefined = 1 << 24,        // Contains undefined or intersection with undefined
    IsNull = 1 << 25,             // Contains null or intersection with null
    IsUndefinedOrNull = IsUndefined | IsNull,
    All = (1 << 27) - 1,
    // The following members encode facts about particular kinds of types for use in the getTypeFacts function.
    // The presence of a particular fact means that the given test is true for some (and possibly all) values
    // of that kind of type.
    BaseStringStrictFacts = TypeofEQString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEObject | TypeofNEFunction | TypeofNEHostObject | NEUndefined | NENull | NEUndefinedOrNull,
    BaseStringFacts = BaseStringStrictFacts | EQUndefined | EQNull | EQUndefinedOrNull | Falsy,
    StringStrictFacts = BaseStringStrictFacts | Truthy | Falsy,
    StringFacts = BaseStringFacts | Truthy,
    EmptyStringStrictFacts = BaseStringStrictFacts | Falsy,
    EmptyStringFacts = BaseStringFacts,
    NonEmptyStringStrictFacts = BaseStringStrictFacts | Truthy,
    NonEmptyStringFacts = BaseStringFacts | Truthy,
    BaseNumberStrictFacts = TypeofEQNumber | TypeofNEString | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEObject | TypeofNEFunction | TypeofNEHostObject | NEUndefined | NENull | NEUndefinedOrNull,
    BaseNumberFacts = BaseNumberStrictFacts | EQUndefined | EQNull | EQUndefinedOrNull | Falsy,
    NumberStrictFacts = BaseNumberStrictFacts | Truthy | Falsy,
    NumberFacts = BaseNumberFacts | Truthy,
    ZeroNumberStrictFacts = BaseNumberStrictFacts | Falsy,
    ZeroNumberFacts = BaseNumberFacts,
    NonZeroNumberStrictFacts = BaseNumberStrictFacts | Truthy,
    NonZeroNumberFacts = BaseNumberFacts | Truthy,
    BaseBigIntStrictFacts = TypeofEQBigInt | TypeofNEString | TypeofNENumber | TypeofNEBoolean | TypeofNESymbol | TypeofNEObject | TypeofNEFunction | TypeofNEHostObject | NEUndefined | NENull | NEUndefinedOrNull,
    BaseBigIntFacts = BaseBigIntStrictFacts | EQUndefined | EQNull | EQUndefinedOrNull | Falsy,
    BigIntStrictFacts = BaseBigIntStrictFacts | Truthy | Falsy,
    BigIntFacts = BaseBigIntFacts | Truthy,
    ZeroBigIntStrictFacts = BaseBigIntStrictFacts | Falsy,
    ZeroBigIntFacts = BaseBigIntFacts,
    NonZeroBigIntStrictFacts = BaseBigIntStrictFacts | Truthy,
    NonZeroBigIntFacts = BaseBigIntFacts | Truthy,
    BaseBooleanStrictFacts = TypeofEQBoolean | TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNESymbol | TypeofNEObject | TypeofNEFunction | TypeofNEHostObject | NEUndefined | NENull | NEUndefinedOrNull,
    BaseBooleanFacts = BaseBooleanStrictFacts | EQUndefined | EQNull | EQUndefinedOrNull | Falsy,
    BooleanStrictFacts = BaseBooleanStrictFacts | Truthy | Falsy,
    BooleanFacts = BaseBooleanFacts | Truthy,
    FalseStrictFacts = BaseBooleanStrictFacts | Falsy,
    FalseFacts = BaseBooleanFacts,
    TrueStrictFacts = BaseBooleanStrictFacts | Truthy,
    TrueFacts = BaseBooleanFacts | Truthy,
    SymbolStrictFacts = TypeofEQSymbol | TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNEObject | TypeofNEFunction | TypeofNEHostObject | NEUndefined | NENull | NEUndefinedOrNull | Truthy,
    SymbolFacts = SymbolStrictFacts | EQUndefined | EQNull | EQUndefinedOrNull | Falsy,
    ObjectStrictFacts = TypeofEQObject | TypeofEQHostObject | TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEFunction | NEUndefined | NENull | NEUndefinedOrNull | Truthy,
    ObjectFacts = ObjectStrictFacts | EQUndefined | EQNull | EQUndefinedOrNull | Falsy,
    FunctionStrictFacts = TypeofEQFunction | TypeofEQHostObject | TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEObject | NEUndefined | NENull | NEUndefinedOrNull | Truthy,
    FunctionFacts = FunctionStrictFacts | EQUndefined | EQNull | EQUndefinedOrNull | Falsy,
    VoidFacts = TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEObject | TypeofNEFunction | TypeofNEHostObject | EQUndefined | EQUndefinedOrNull | NENull | Falsy,
    UndefinedFacts = TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEObject | TypeofNEFunction | TypeofNEHostObject | EQUndefined | EQUndefinedOrNull | NENull | Falsy | IsUndefined,
    NullFacts = TypeofEQObject | TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEFunction | TypeofNEHostObject | EQNull | EQUndefinedOrNull | NEUndefined | Falsy | IsNull,
    EmptyObjectStrictFacts = All & ~(EQUndefined | EQNull | EQUndefinedOrNull | IsUndefinedOrNull),
    EmptyObjectFacts = All & ~IsUndefinedOrNull,
    UnknownFacts = All & ~IsUndefinedOrNull,
    AllTypeofNE = TypeofNEString | TypeofNENumber | TypeofNEBigInt | TypeofNEBoolean | TypeofNESymbol | TypeofNEObject | TypeofNEFunction | NEUndefined,
    // Masks
    OrFactsMask = TypeofEQFunction | TypeofNEObject,
    AndFactsMask = All & ~OrFactsMask,
}
declare const enum TypeSystemPropertyName {
    Type,
    ResolvedBaseConstructorType,
    DeclaredType,
    ResolvedReturnType,
    ImmediateBaseConstraint,
    ResolvedTypeArguments,
    ResolvedBaseTypes,
    WriteType,
    ParameterInitializerContainsUndefined,
}
export declare const enum CheckMode {
    Normal = 0,                                     // Normal type checking
    Contextual = 1 << 0,                            // Explicitly assigned contextual type, therefore not cacheable
    Inferential = 1 << 1,                           // Inferential typing
    SkipContextSensitive = 1 << 2,                  // Skip context sensitive function expressions
    SkipGenericFunctions = 1 << 3,                  // Skip single signature generic functions
    IsForSignatureHelp = 1 << 4,                    // Call resolution for purposes of signature help
    RestBindingElement = 1 << 5,                    // Checking a type that is going to be used to determine the type of a rest binding element
                                                    //   e.g. in `const { a, ...rest } = foo`, when checking the type of `foo` to determine the type of `rest`,
                                                    //   we need to preserve generic types instead of substituting them for constraints
    TypeOnly = 1 << 6,                              // Called from getTypeOfExpression, diagnostics may be omitted
}
export declare const enum SignatureCheckMode {
    None = 0,
    BivariantCallback = 1 << 0,
    StrictCallback = 1 << 1,
    IgnoreReturnTypes = 1 << 2,
    StrictArity = 1 << 3,
    StrictTopSignature = 1 << 4,
    Callback = BivariantCallback | StrictCallback,
}
declare const enum IntersectionState {
    None = 0,
    Source = 1 << 0, // Source type is a constituent of an outer intersection
    Target = 1 << 1, // Target type is a constituent of an outer intersection
}
declare const enum RecursionFlags {
    None = 0,
    Source = 1 << 0,
    Target = 1 << 1,
    Both = Source | Target,
}
declare const enum MappedTypeModifiers {
    IncludeReadonly = 1 << 0,
    ExcludeReadonly = 1 << 1,
    IncludeOptional = 1 << 2,
    ExcludeOptional = 1 << 3,
}
declare const enum MappedTypeNameTypeKind {
    None,
    Filtering,
    Remapping,
}
declare const enum ExpandingFlags {
    None = 0,
    Source = 1,
    Target = 1 << 1,
    Both = Source | Target,
}
declare const enum MembersOrExportsResolutionKind {
    resolvedExports = "resolvedExports",
    resolvedMembers = "resolvedMembers",
}
declare const enum UnusedKind {
    Local,
    Parameter,
}
declare const enum DeclarationMeaning {
    GetAccessor = 1,
    SetAccessor = 2,
    PropertyAssignment = 4,
    Method = 8,
    PrivateStatic = 16,
    GetOrSetAccessor = GetAccessor | SetAccessor,
    PropertyAssignmentOrMethod = PropertyAssignment | Method,
}
declare const enum DeclarationSpaces {
    None = 0,
    ExportValue = 1 << 0,
    ExportType = 1 << 1,
    ExportNamespace = 1 << 2,
}
declare const enum MinArgumentCountFlags {
    None = 0,
    StrongArityForUntypedJS = 1 << 0,
    VoidIsNonOptional = 1 << 1,
}
declare const enum IntrinsicTypeKind {
    Uppercase,
    Lowercase,
    Capitalize,
    Uncapitalize,
    NoInfer,
}
declare namespace JsxNames {
  export const JSX: string;
  export const IntrinsicElements: string;
  export const ElementClass: string;
  export const ElementAttributesPropertyNameContainer: string;
  export const ElementChildrenAttributeNameContainer: string;
  export const Element: string;
  export const ElementType: string;
  export const IntrinsicAttributes: string;
  export const IntrinsicClassAttributes: string;
  export const LibraryManagedAttributes: string;
}