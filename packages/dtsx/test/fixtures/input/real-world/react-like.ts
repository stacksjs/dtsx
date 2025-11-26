/**
 * React-like component library types
 * Based on common patterns from React
 */

// Basic types
export type Key = string | number
export type Ref<T> = RefCallback<T> | RefObject<T> | null
export type RefCallback<T> = (instance: T | null) => void

export interface RefObject<T> {
  readonly current: T | null
}

// JSX types
export type JSXElementConstructor<P> =
  | ((props: P) => ReactElement<any, any> | null)
  | (new (props: P) => Component<any, any>)

export interface ReactElement<
  P = any,
  T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>,
> {
  type: T
  props: P
  key: Key | null
}

export type ReactNode =
  | ReactElement
  | string
  | number
  | Iterable<ReactNode>
  | ReactPortal
  | boolean
  | null
  | undefined

export interface ReactPortal extends ReactElement {
  children: ReactNode
}

// Component types
export interface ComponentClass<P = {}, S = ComponentState> {
  new (props: P, context?: any): Component<P, S>
  propTypes?: WeakValidationMap<P>
  contextType?: Context<any>
  contextTypes?: ValidationMap<any>
  childContextTypes?: ValidationMap<any>
  defaultProps?: Partial<P>
  displayName?: string
}

export type ComponentState = any

export interface Component<P = {}, S = {}, SS = any> {
  constructor(props: P)
  constructor(props: P, context: any)
  setState<K extends keyof S>(
    state: ((prevState: Readonly<S>, props: Readonly<P>) => Pick<S, K> | S | null) | (Pick<S, K> | S | null),
    callback?: () => void,
  ): void
  forceUpdate(callback?: () => void): void
  render(): ReactNode
  readonly props: Readonly<P>
  state: Readonly<S>
  context: unknown
  refs: { [key: string]: ReactInstance }
}

export type ReactInstance = Component<any> | Element

export type FC<P = {}> = FunctionComponent<P>

export interface FunctionComponent<P = {}> {
  (props: P): ReactElement<any, any> | null
  propTypes?: WeakValidationMap<P>
  contextTypes?: ValidationMap<any>
  defaultProps?: Partial<P>
  displayName?: string
}

export type PropsWithChildren<P = unknown> = P & { children?: ReactNode | undefined }

export type PropsWithoutRef<P> = P extends { ref?: infer R }
  ? Pick<P, Exclude<keyof P, 'ref'>>
  : P

export type ComponentPropsWithRef<T extends ElementType> = T extends new (props: infer P) => Component<any, any>
  ? PropsWithoutRef<P> & RefAttributes<InstanceType<T>>
  : PropsWithRef<ComponentProps<T>>

export type ComponentPropsWithoutRef<T extends ElementType> = PropsWithoutRef<ComponentProps<T>>

export type ComponentProps<T extends keyof JSXIntrinsicElements | JSXElementConstructor<any>> =
  T extends JSXElementConstructor<infer P>
    ? P
    : T extends keyof JSXIntrinsicElements
      ? JSXIntrinsicElements[T]
      : {}

export type PropsWithRef<P> = P & { ref?: Ref<any> }

export interface RefAttributes<T> {
  ref?: Ref<T>
}

export interface Attributes {
  key?: Key | null | undefined
}

export type ElementType<P = any> =
  | { [K in keyof JSXIntrinsicElements]: P extends JSXIntrinsicElements[K] ? K : never }[keyof JSXIntrinsicElements]
  | ComponentType<P>

export type ComponentType<P = {}> = ComponentClass<P> | FunctionComponent<P>

// Context
export interface Context<T> {
  Provider: Provider<T>
  Consumer: Consumer<T>
  displayName?: string | undefined
}

export interface Provider<T> {
  (props: ProviderProps<T>): ReactElement | null
}

export interface Consumer<T> {
  (props: ConsumerProps<T>): ReactElement | null
}

export interface ProviderProps<T> {
  value: T
  children?: ReactNode | undefined
}

export interface ConsumerProps<T> {
  children: (value: T) => ReactNode
}

export function createContext<T>(defaultValue: T): Context<T>

// Hooks
export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>]

export type Dispatch<A> = (value: A) => void
export type SetStateAction<S> = S | ((prevState: S) => S)

export function useEffect(effect: EffectCallback, deps?: DependencyList): void
export function useLayoutEffect(effect: EffectCallback, deps?: DependencyList): void
export function useInsertionEffect(effect: EffectCallback, deps?: DependencyList): void

export type EffectCallback = () => void | Destructor
export type Destructor = () => void | { [UNDEFINED_VOID_ONLY]: never }
export type DependencyList = readonly unknown[]

declare const UNDEFINED_VOID_ONLY: unique symbol

export function useContext<T>(context: Context<T>): T

export function useReducer<R extends Reducer<any, any>, I>(
  reducer: R,
  initializerArg: I & ReducerState<R>,
  initializer: (arg: I & ReducerState<R>) => ReducerState<R>,
): [ReducerState<R>, Dispatch<ReducerAction<R>>]

export function useReducer<R extends Reducer<any, any>, I>(
  reducer: R,
  initializerArg: I,
  initializer: (arg: I) => ReducerState<R>,
): [ReducerState<R>, Dispatch<ReducerAction<R>>]

export function useReducer<R extends Reducer<any, any>>(
  reducer: R,
  initialState: ReducerState<R>,
  initializer?: undefined,
): [ReducerState<R>, Dispatch<ReducerAction<R>>]

export type Reducer<S, A> = (prevState: S, action: A) => S
export type ReducerState<R extends Reducer<any, any>> = R extends Reducer<infer S, any> ? S : never
export type ReducerAction<R extends Reducer<any, any>> = R extends Reducer<any, infer A> ? A : never

export function useCallback<T extends Function>(callback: T, deps: DependencyList): T
export function useMemo<T>(factory: () => T, deps: DependencyList | undefined): T
export function useRef<T>(initialValue: T): MutableRefObject<T>
export function useRef<T>(initialValue: T | null): RefObject<T>
export function useRef<T = undefined>(): MutableRefObject<T | undefined>

export interface MutableRefObject<T> {
  current: T
}

export function useImperativeHandle<T, R extends T>(
  ref: Ref<T> | undefined,
  init: () => R,
  deps?: DependencyList,
): void

export function useDebugValue<T>(value: T, format?: (value: T) => any): void

export function useDeferredValue<T>(value: T): T
export function useTransition(): [boolean, TransitionStartFunction]

export type TransitionStartFunction = (callback: TransitionFunction) => void
export type TransitionFunction = () => void

export function useId(): string

export function useSyncExternalStore<Snapshot>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot?: () => Snapshot,
): Snapshot

// Memo and Forward Ref
export function memo<P extends object>(
  Component: FunctionComponent<P>,
  propsAreEqual?: (prevProps: Readonly<P>, nextProps: Readonly<P>) => boolean,
): NamedExoticComponent<P>

export function memo<T extends ComponentType<any>>(
  Component: T,
  propsAreEqual?: (prevProps: Readonly<ComponentProps<T>>, nextProps: Readonly<ComponentProps<T>>) => boolean,
): MemoExoticComponent<T>

export interface NamedExoticComponent<P = {}> extends ExoticComponent<P> {
  displayName?: string | undefined
}

export interface ExoticComponent<P = {}> {
  (props: P): ReactElement | null
  readonly $$typeof: symbol
}

export interface MemoExoticComponent<T extends ComponentType<any>> extends NamedExoticComponent<ComponentPropsWithRef<T>> {
  readonly type: T
}

export function forwardRef<T, P = {}>(
  render: ForwardRefRenderFunction<T, P>,
): ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>>

export interface ForwardRefRenderFunction<T, P = {}> {
  (props: P, ref: ForwardedRef<T>): ReactElement | null
  displayName?: string | undefined
  defaultProps?: never | undefined
  propTypes?: never | undefined
}

export type ForwardedRef<T> = ((instance: T | null) => void) | MutableRefObject<T | null> | null

export interface ForwardRefExoticComponent<P> extends NamedExoticComponent<P> {
  defaultProps?: Partial<P> | undefined
  propTypes?: WeakValidationMap<P> | undefined
}

// Lazy and Suspense
export function lazy<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T>

export interface LazyExoticComponent<T extends ComponentType<any>> extends ExoticComponent<ComponentPropsWithRef<T>> {
  readonly _result: T
}

export interface SuspenseProps {
  children?: ReactNode | undefined
  fallback?: ReactNode
}

export const Suspense: ExoticComponent<SuspenseProps>

// Fragment
export interface FragmentProps {
  children?: ReactNode | undefined
  key?: Key | null | undefined
}

export const Fragment: ExoticComponent<FragmentProps>

// Profiler
export interface ProfilerProps {
  children?: ReactNode | undefined
  id: string
  onRender: ProfilerOnRenderCallback
}

export type ProfilerOnRenderCallback = (
  id: string,
  phase: 'mount' | 'update',
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
  interactions: Set<SchedulerInteraction>,
) => void

export interface SchedulerInteraction {
  __count: number
  id: number
  name: string
  timestamp: number
}

export const Profiler: ExoticComponent<ProfilerProps>

// StrictMode
export interface StrictModeProps {
  children?: ReactNode | undefined
}

export const StrictMode: ExoticComponent<StrictModeProps>

// createElement
export function createElement<P extends {}>(
  type: FunctionComponent<P> | ComponentClass<P> | string,
  props?: (Attributes & P) | null,
  ...children: ReactNode[]
): ReactElement<P>

// cloneElement
export function cloneElement<P>(
  element: ReactElement<P>,
  props?: Partial<P> & Attributes,
  ...children: ReactNode[]
): ReactElement<P>

// isValidElement
export function isValidElement<P>(object: {} | null | undefined): object is ReactElement<P>

// Children
export interface ReactChildren {
  map<T, C>(children: C | readonly C[], fn: (child: C, index: number) => T): C extends null | undefined ? C : T[]
  forEach<C>(children: C | readonly C[], fn: (child: C, index: number) => void): void
  count(children: any): number
  only<C>(children: C): C extends any[] ? never : C
  toArray(children: ReactNode | ReactNode[]): ReactElement[]
}

export const Children: ReactChildren

// Validation
export interface Validator<T> {
  (props: { [key: string]: any }, propName: string, componentName: string, location: string, propFullName: string): Error | null
}

export interface Requireable<T> extends Validator<T | undefined | null> {
  isRequired: Validator<NonNullable<T>>
}

export type ValidationMap<T> = { [K in keyof T]?: Validator<T[K]> }
export type WeakValidationMap<T> = { [K in keyof T]?: null extends T[K] ? Validator<T[K] | null | undefined> : undefined extends T[K] ? Validator<T[K] | null | undefined> : Validator<T[K]> }

// PropTypes (subset)
export const PropTypes: {
  any: Requireable<any>
  array: Requireable<any[]>
  bool: Requireable<boolean>
  func: Requireable<(...args: any[]) => any>
  number: Requireable<number>
  object: Requireable<object>
  string: Requireable<string>
  node: Requireable<ReactNode>
  element: Requireable<ReactElement>
  instanceOf<T>(expectedClass: new (...args: any[]) => T): Requireable<T>
  oneOf<T>(types: readonly T[]): Requireable<T>
  oneOfType<T extends Validator<any>>(types: T[]): Requireable<NonNullable<T extends Validator<infer U> ? U : never>>
  arrayOf<T>(type: Validator<T>): Requireable<T[]>
  objectOf<T>(type: Validator<T>): Requireable<{ [key: string]: T }>
  shape<P extends ValidationMap<any>>(type: P): Requireable<{ [K in keyof P]?: P[K] extends Validator<infer T> ? T : never }>
  exact<P extends ValidationMap<any>>(type: P): Requireable<{ [K in keyof P]?: P[K] extends Validator<infer T> ? T : never }>
}

// Events
export interface BaseSyntheticEvent<E = object, C = any, T = any> {
  nativeEvent: E
  currentTarget: C
  target: T
  bubbles: boolean
  cancelable: boolean
  defaultPrevented: boolean
  eventPhase: number
  isTrusted: boolean
  preventDefault(): void
  isDefaultPrevented(): boolean
  stopPropagation(): void
  isPropagationStopped(): boolean
  persist(): void
  timeStamp: number
  type: string
}

export interface SyntheticEvent<T = Element, E = Event> extends BaseSyntheticEvent<E, EventTarget & T, EventTarget> {}

export interface ClipboardEvent<T = Element> extends SyntheticEvent<T, NativeClipboardEvent> {
  clipboardData: DataTransfer
}

export interface CompositionEvent<T = Element> extends SyntheticEvent<T, NativeCompositionEvent> {
  data: string
}

export interface DragEvent<T = Element> extends MouseEvent<T, NativeDragEvent> {
  dataTransfer: DataTransfer
}

export interface FocusEvent<T = Element, R = Element> extends SyntheticEvent<T, NativeFocusEvent> {
  relatedTarget: (EventTarget & R) | null
  target: EventTarget & T
}

export interface FormEvent<T = Element> extends SyntheticEvent<T> {}

export interface ChangeEvent<T = Element> extends SyntheticEvent<T> {
  target: EventTarget & T
}

export interface KeyboardEvent<T = Element> extends UIEvent<T, NativeKeyboardEvent> {
  altKey: boolean
  charCode: number
  ctrlKey: boolean
  code: string
  key: string
  keyCode: number
  locale: string
  location: number
  metaKey: boolean
  repeat: boolean
  shiftKey: boolean
  which: number
  getModifierState(key: ModifierKey): boolean
}

export interface MouseEvent<T = Element, E = NativeMouseEvent> extends UIEvent<T, E> {
  altKey: boolean
  button: number
  buttons: number
  clientX: number
  clientY: number
  ctrlKey: boolean
  metaKey: boolean
  movementX: number
  movementY: number
  pageX: number
  pageY: number
  relatedTarget: EventTarget | null
  screenX: number
  screenY: number
  shiftKey: boolean
  getModifierState(key: ModifierKey): boolean
}

export interface TouchEvent<T = Element> extends UIEvent<T, NativeTouchEvent> {
  altKey: boolean
  changedTouches: TouchList
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  targetTouches: TouchList
  touches: TouchList
  getModifierState(key: ModifierKey): boolean
}

export interface PointerEvent<T = Element> extends MouseEvent<T, NativePointerEvent> {
  pointerId: number
  pressure: number
  tangentialPressure: number
  tiltX: number
  tiltY: number
  twist: number
  width: number
  height: number
  pointerType: 'mouse' | 'pen' | 'touch'
  isPrimary: boolean
}

export interface UIEvent<T = Element, E = NativeUIEvent> extends SyntheticEvent<T, E> {
  detail: number
  view: AbstractView
}

export interface WheelEvent<T = Element> extends MouseEvent<T, NativeWheelEvent> {
  deltaMode: number
  deltaX: number
  deltaY: number
  deltaZ: number
}

export interface AnimationEvent<T = Element> extends SyntheticEvent<T, NativeAnimationEvent> {
  animationName: string
  elapsedTime: number
  pseudoElement: string
}

export interface TransitionEvent<T = Element> extends SyntheticEvent<T, NativeTransitionEvent> {
  elapsedTime: number
  propertyName: string
  pseudoElement: string
}

// Native event types (placeholders)
type NativeClipboardEvent = ClipboardEvent
type NativeCompositionEvent = CompositionEvent
type NativeDragEvent = DragEvent
type NativeFocusEvent = FocusEvent
type NativeKeyboardEvent = KeyboardEvent
type NativeMouseEvent = MouseEvent
type NativeTouchEvent = TouchEvent
type NativePointerEvent = PointerEvent
type NativeUIEvent = UIEvent
type NativeWheelEvent = WheelEvent
type NativeAnimationEvent = AnimationEvent
type NativeTransitionEvent = TransitionEvent

type ModifierKey = 'Alt' | 'AltGraph' | 'CapsLock' | 'Control' | 'Fn' | 'FnLock' | 'Hyper' | 'Meta' | 'NumLock' | 'ScrollLock' | 'Shift' | 'Super' | 'Symbol' | 'SymbolLock'

interface AbstractView {
  styleMedia: StyleMedia
  document: Document
}

// JSX namespace
export interface JSXIntrinsicElements {
  // HTML
  a: AnchorHTMLAttributes<HTMLAnchorElement>
  abbr: HTMLAttributes<HTMLElement>
  address: HTMLAttributes<HTMLElement>
  area: AreaHTMLAttributes<HTMLAreaElement>
  article: HTMLAttributes<HTMLElement>
  aside: HTMLAttributes<HTMLElement>
  audio: AudioHTMLAttributes<HTMLAudioElement>
  b: HTMLAttributes<HTMLElement>
  base: BaseHTMLAttributes<HTMLBaseElement>
  bdi: HTMLAttributes<HTMLElement>
  bdo: HTMLAttributes<HTMLElement>
  blockquote: BlockquoteHTMLAttributes<HTMLQuoteElement>
  body: HTMLAttributes<HTMLBodyElement>
  br: HTMLAttributes<HTMLBRElement>
  button: ButtonHTMLAttributes<HTMLButtonElement>
  canvas: CanvasHTMLAttributes<HTMLCanvasElement>
  caption: HTMLAttributes<HTMLElement>
  cite: HTMLAttributes<HTMLElement>
  code: HTMLAttributes<HTMLElement>
  col: ColHTMLAttributes<HTMLTableColElement>
  colgroup: ColgroupHTMLAttributes<HTMLTableColElement>
  data: DataHTMLAttributes<HTMLDataElement>
  datalist: HTMLAttributes<HTMLDataListElement>
  dd: HTMLAttributes<HTMLElement>
  del: DelHTMLAttributes<HTMLModElement>
  details: DetailsHTMLAttributes<HTMLDetailsElement>
  dfn: HTMLAttributes<HTMLElement>
  dialog: DialogHTMLAttributes<HTMLDialogElement>
  div: HTMLAttributes<HTMLDivElement>
  dl: HTMLAttributes<HTMLDListElement>
  dt: HTMLAttributes<HTMLElement>
  em: HTMLAttributes<HTMLElement>
  embed: EmbedHTMLAttributes<HTMLEmbedElement>
  fieldset: FieldsetHTMLAttributes<HTMLFieldSetElement>
  figcaption: HTMLAttributes<HTMLElement>
  figure: HTMLAttributes<HTMLElement>
  footer: HTMLAttributes<HTMLElement>
  form: FormHTMLAttributes<HTMLFormElement>
  h1: HTMLAttributes<HTMLHeadingElement>
  h2: HTMLAttributes<HTMLHeadingElement>
  h3: HTMLAttributes<HTMLHeadingElement>
  h4: HTMLAttributes<HTMLHeadingElement>
  h5: HTMLAttributes<HTMLHeadingElement>
  h6: HTMLAttributes<HTMLHeadingElement>
  head: HTMLAttributes<HTMLHeadElement>
  header: HTMLAttributes<HTMLElement>
  hgroup: HTMLAttributes<HTMLElement>
  hr: HTMLAttributes<HTMLHRElement>
  html: HtmlHTMLAttributes<HTMLHtmlElement>
  i: HTMLAttributes<HTMLElement>
  iframe: IframeHTMLAttributes<HTMLIFrameElement>
  img: ImgHTMLAttributes<HTMLImageElement>
  input: InputHTMLAttributes<HTMLInputElement>
  ins: InsHTMLAttributes<HTMLModElement>
  kbd: HTMLAttributes<HTMLElement>
  label: LabelHTMLAttributes<HTMLLabelElement>
  legend: HTMLAttributes<HTMLLegendElement>
  li: LiHTMLAttributes<HTMLLIElement>
  link: LinkHTMLAttributes<HTMLLinkElement>
  main: HTMLAttributes<HTMLElement>
  map: MapHTMLAttributes<HTMLMapElement>
  mark: HTMLAttributes<HTMLElement>
  menu: MenuHTMLAttributes<HTMLElement>
  meta: MetaHTMLAttributes<HTMLMetaElement>
  meter: MeterHTMLAttributes<HTMLMeterElement>
  nav: HTMLAttributes<HTMLElement>
  noscript: HTMLAttributes<HTMLElement>
  object: ObjectHTMLAttributes<HTMLObjectElement>
  ol: OlHTMLAttributes<HTMLOListElement>
  optgroup: OptgroupHTMLAttributes<HTMLOptGroupElement>
  option: OptionHTMLAttributes<HTMLOptionElement>
  output: OutputHTMLAttributes<HTMLOutputElement>
  p: HTMLAttributes<HTMLParagraphElement>
  picture: HTMLAttributes<HTMLElement>
  pre: HTMLAttributes<HTMLPreElement>
  progress: ProgressHTMLAttributes<HTMLProgressElement>
  q: QuoteHTMLAttributes<HTMLQuoteElement>
  rp: HTMLAttributes<HTMLElement>
  rt: HTMLAttributes<HTMLElement>
  ruby: HTMLAttributes<HTMLElement>
  s: HTMLAttributes<HTMLElement>
  samp: HTMLAttributes<HTMLElement>
  script: ScriptHTMLAttributes<HTMLScriptElement>
  section: HTMLAttributes<HTMLElement>
  select: SelectHTMLAttributes<HTMLSelectElement>
  slot: SlotHTMLAttributes<HTMLSlotElement>
  small: HTMLAttributes<HTMLElement>
  source: SourceHTMLAttributes<HTMLSourceElement>
  span: HTMLAttributes<HTMLSpanElement>
  strong: HTMLAttributes<HTMLElement>
  style: StyleHTMLAttributes<HTMLStyleElement>
  sub: HTMLAttributes<HTMLElement>
  summary: HTMLAttributes<HTMLElement>
  sup: HTMLAttributes<HTMLElement>
  table: TableHTMLAttributes<HTMLTableElement>
  tbody: HTMLAttributes<HTMLTableSectionElement>
  td: TdHTMLAttributes<HTMLTableDataCellElement>
  template: HTMLAttributes<HTMLTemplateElement>
  textarea: TextareaHTMLAttributes<HTMLTextAreaElement>
  tfoot: HTMLAttributes<HTMLTableSectionElement>
  th: ThHTMLAttributes<HTMLTableHeaderCellElement>
  thead: HTMLAttributes<HTMLTableSectionElement>
  time: TimeHTMLAttributes<HTMLTimeElement>
  title: HTMLAttributes<HTMLTitleElement>
  tr: HTMLAttributes<HTMLTableRowElement>
  track: TrackHTMLAttributes<HTMLTrackElement>
  u: HTMLAttributes<HTMLElement>
  ul: HTMLAttributes<HTMLUListElement>
  var: HTMLAttributes<HTMLElement>
  video: VideoHTMLAttributes<HTMLVideoElement>
  wbr: HTMLAttributes<HTMLElement>

  // SVG
  svg: SVGAttributes<SVGSVGElement>
  path: SVGAttributes<SVGPathElement>
  circle: SVGAttributes<SVGCircleElement>
  rect: SVGAttributes<SVGRectElement>
  line: SVGAttributes<SVGLineElement>
  polygon: SVGAttributes<SVGPolygonElement>
  polyline: SVGAttributes<SVGPolylineElement>
  ellipse: SVGAttributes<SVGEllipseElement>
  g: SVGAttributes<SVGGElement>
  text: SVGAttributes<SVGTextElement>
  defs: SVGAttributes<SVGDefsElement>
  use: SVGAttributes<SVGUseElement>
}

// HTML Attributes (simplified)
export interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
  className?: string
  id?: string
  style?: CSSProperties
  title?: string
  tabIndex?: number
  hidden?: boolean
  dir?: string
  lang?: string
  slot?: string
  spellCheck?: boolean
  translate?: 'yes' | 'no'
  radioGroup?: string
  role?: AriaRole
  about?: string
  content?: string
  datatype?: string
  inlist?: any
  prefix?: string
  property?: string
  rel?: string
  resource?: string
  rev?: string
  typeof?: string
  vocab?: string
  autoCapitalize?: string
  autoCorrect?: string
  autoSave?: string
  color?: string
  itemProp?: string
  itemScope?: boolean
  itemType?: string
  itemID?: string
  itemRef?: string
  results?: number
  security?: string
  unselectable?: 'on' | 'off'
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search'
  is?: string
}

export interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> {
  download?: any
  href?: string
  hrefLang?: string
  media?: string
  ping?: string
  referrerPolicy?: ReferrerPolicy
  target?: string
  type?: string
}

export interface AreaHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface AudioHTMLAttributes<T> extends MediaHTMLAttributes<T> {}
export interface BaseHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface BlockquoteHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
  disabled?: boolean
  form?: string
  formAction?: string
  formEncType?: string
  formMethod?: string
  formNoValidate?: boolean
  formTarget?: string
  name?: string
  type?: 'submit' | 'reset' | 'button'
  value?: string | readonly string[] | number
}
export interface CanvasHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface ColHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface ColgroupHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface DataHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface DelHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface DetailsHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface DialogHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface EmbedHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface FieldsetHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface FormHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface HtmlHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface IframeHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface ImgHTMLAttributes<T> extends HTMLAttributes<T> {
  alt?: string
  src?: string
  srcSet?: string
  width?: number | string
  height?: number | string
  loading?: 'eager' | 'lazy'
}
export interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
  type?: string
  value?: string | readonly string[] | number
  checked?: boolean
  disabled?: boolean
  placeholder?: string
  name?: string
  required?: boolean
  min?: number | string
  max?: number | string
  step?: number | string
  pattern?: string
  readOnly?: boolean
  autoComplete?: string
  autoFocus?: boolean
}
export interface InsHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface LabelHTMLAttributes<T> extends HTMLAttributes<T> {
  htmlFor?: string
}
export interface LiHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface LinkHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface MapHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface MediaHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface MenuHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface MetaHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface MeterHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface ObjectHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface OlHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface OptgroupHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface OptionHTMLAttributes<T> extends HTMLAttributes<T> {
  value?: string | readonly string[] | number
  selected?: boolean
  disabled?: boolean
  label?: string
}
export interface OutputHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface ProgressHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface QuoteHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface ScriptHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface SelectHTMLAttributes<T> extends HTMLAttributes<T> {
  value?: string | readonly string[] | number
  multiple?: boolean
  disabled?: boolean
  name?: string
  required?: boolean
}
export interface SlotHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface SourceHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface StyleHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface TableHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface TdHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> {
  value?: string | readonly string[] | number
  disabled?: boolean
  placeholder?: string
  name?: string
  required?: boolean
  rows?: number
  cols?: number
  readOnly?: boolean
}
export interface ThHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface TimeHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface TrackHTMLAttributes<T> extends HTMLAttributes<T> {}
export interface VideoHTMLAttributes<T> extends MediaHTMLAttributes<T> {}

export interface SVGAttributes<T> extends AriaAttributes, DOMAttributes<T> {
  className?: string
  id?: string
  style?: CSSProperties
}

export interface AriaAttributes {
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-hidden'?: boolean | 'true' | 'false'
  'aria-disabled'?: boolean | 'true' | 'false'
  'aria-expanded'?: boolean | 'true' | 'false'
  'aria-haspopup'?: boolean | 'true' | 'false' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'
  'aria-pressed'?: boolean | 'true' | 'false' | 'mixed'
  'aria-selected'?: boolean | 'true' | 'false'
  'aria-checked'?: boolean | 'true' | 'false' | 'mixed'
  'aria-live'?: 'off' | 'assertive' | 'polite'
  'aria-atomic'?: boolean | 'true' | 'false'
  'aria-busy'?: boolean | 'true' | 'false'
  'aria-current'?: boolean | 'true' | 'false' | 'page' | 'step' | 'location' | 'date' | 'time'
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'
  'aria-required'?: boolean | 'true' | 'false'
  'aria-roledescription'?: string
  'aria-valuemax'?: number
  'aria-valuemin'?: number
  'aria-valuenow'?: number
  'aria-valuetext'?: string
}

export type AriaRole =
  | 'alert'
  | 'alertdialog'
  | 'application'
  | 'article'
  | 'banner'
  | 'button'
  | 'cell'
  | 'checkbox'
  | 'columnheader'
  | 'combobox'
  | 'complementary'
  | 'contentinfo'
  | 'definition'
  | 'dialog'
  | 'directory'
  | 'document'
  | 'feed'
  | 'figure'
  | 'form'
  | 'grid'
  | 'gridcell'
  | 'group'
  | 'heading'
  | 'img'
  | 'link'
  | 'list'
  | 'listbox'
  | 'listitem'
  | 'log'
  | 'main'
  | 'marquee'
  | 'math'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'menuitemcheckbox'
  | 'menuitemradio'
  | 'navigation'
  | 'none'
  | 'note'
  | 'option'
  | 'presentation'
  | 'progressbar'
  | 'radio'
  | 'radiogroup'
  | 'region'
  | 'row'
  | 'rowgroup'
  | 'rowheader'
  | 'scrollbar'
  | 'search'
  | 'searchbox'
  | 'separator'
  | 'slider'
  | 'spinbutton'
  | 'status'
  | 'switch'
  | 'tab'
  | 'table'
  | 'tablist'
  | 'tabpanel'
  | 'term'
  | 'textbox'
  | 'timer'
  | 'toolbar'
  | 'tooltip'
  | 'tree'
  | 'treegrid'
  | 'treeitem'

export interface DOMAttributes<T> {
  children?: ReactNode
  dangerouslySetInnerHTML?: { __html: string }

  // Clipboard Events
  onCopy?: ClipboardEventHandler<T>
  onCopyCapture?: ClipboardEventHandler<T>
  onCut?: ClipboardEventHandler<T>
  onCutCapture?: ClipboardEventHandler<T>
  onPaste?: ClipboardEventHandler<T>
  onPasteCapture?: ClipboardEventHandler<T>

  // Focus Events
  onFocus?: FocusEventHandler<T>
  onFocusCapture?: FocusEventHandler<T>
  onBlur?: FocusEventHandler<T>
  onBlurCapture?: FocusEventHandler<T>

  // Form Events
  onChange?: FormEventHandler<T>
  onChangeCapture?: FormEventHandler<T>
  onInput?: FormEventHandler<T>
  onInputCapture?: FormEventHandler<T>
  onSubmit?: FormEventHandler<T>
  onSubmitCapture?: FormEventHandler<T>
  onReset?: FormEventHandler<T>
  onResetCapture?: FormEventHandler<T>

  // Keyboard Events
  onKeyDown?: KeyboardEventHandler<T>
  onKeyDownCapture?: KeyboardEventHandler<T>
  onKeyPress?: KeyboardEventHandler<T>
  onKeyPressCapture?: KeyboardEventHandler<T>
  onKeyUp?: KeyboardEventHandler<T>
  onKeyUpCapture?: KeyboardEventHandler<T>

  // Mouse Events
  onClick?: MouseEventHandler<T>
  onClickCapture?: MouseEventHandler<T>
  onContextMenu?: MouseEventHandler<T>
  onContextMenuCapture?: MouseEventHandler<T>
  onDoubleClick?: MouseEventHandler<T>
  onDoubleClickCapture?: MouseEventHandler<T>
  onMouseDown?: MouseEventHandler<T>
  onMouseDownCapture?: MouseEventHandler<T>
  onMouseEnter?: MouseEventHandler<T>
  onMouseLeave?: MouseEventHandler<T>
  onMouseMove?: MouseEventHandler<T>
  onMouseMoveCapture?: MouseEventHandler<T>
  onMouseOut?: MouseEventHandler<T>
  onMouseOutCapture?: MouseEventHandler<T>
  onMouseOver?: MouseEventHandler<T>
  onMouseOverCapture?: MouseEventHandler<T>
  onMouseUp?: MouseEventHandler<T>
  onMouseUpCapture?: MouseEventHandler<T>

  // Touch Events
  onTouchCancel?: TouchEventHandler<T>
  onTouchCancelCapture?: TouchEventHandler<T>
  onTouchEnd?: TouchEventHandler<T>
  onTouchEndCapture?: TouchEventHandler<T>
  onTouchMove?: TouchEventHandler<T>
  onTouchMoveCapture?: TouchEventHandler<T>
  onTouchStart?: TouchEventHandler<T>
  onTouchStartCapture?: TouchEventHandler<T>

  // Pointer Events
  onPointerDown?: PointerEventHandler<T>
  onPointerDownCapture?: PointerEventHandler<T>
  onPointerMove?: PointerEventHandler<T>
  onPointerMoveCapture?: PointerEventHandler<T>
  onPointerUp?: PointerEventHandler<T>
  onPointerUpCapture?: PointerEventHandler<T>
  onPointerCancel?: PointerEventHandler<T>
  onPointerCancelCapture?: PointerEventHandler<T>
  onPointerEnter?: PointerEventHandler<T>
  onPointerEnterCapture?: PointerEventHandler<T>
  onPointerLeave?: PointerEventHandler<T>
  onPointerLeaveCapture?: PointerEventHandler<T>
  onPointerOver?: PointerEventHandler<T>
  onPointerOverCapture?: PointerEventHandler<T>
  onPointerOut?: PointerEventHandler<T>
  onPointerOutCapture?: PointerEventHandler<T>

  // Wheel Events
  onWheel?: WheelEventHandler<T>
  onWheelCapture?: WheelEventHandler<T>

  // Animation Events
  onAnimationStart?: AnimationEventHandler<T>
  onAnimationStartCapture?: AnimationEventHandler<T>
  onAnimationEnd?: AnimationEventHandler<T>
  onAnimationEndCapture?: AnimationEventHandler<T>
  onAnimationIteration?: AnimationEventHandler<T>
  onAnimationIterationCapture?: AnimationEventHandler<T>

  // Transition Events
  onTransitionEnd?: TransitionEventHandler<T>
  onTransitionEndCapture?: TransitionEventHandler<T>

  // Scroll Events
  onScroll?: UIEventHandler<T>
  onScrollCapture?: UIEventHandler<T>
}

export type EventHandler<E extends SyntheticEvent<any>> = (event: E) => void
export type ClipboardEventHandler<T = Element> = EventHandler<ClipboardEvent<T>>
export type CompositionEventHandler<T = Element> = EventHandler<CompositionEvent<T>>
export type DragEventHandler<T = Element> = EventHandler<DragEvent<T>>
export type FocusEventHandler<T = Element> = EventHandler<FocusEvent<T>>
export type FormEventHandler<T = Element> = EventHandler<FormEvent<T>>
export type ChangeEventHandler<T = Element> = EventHandler<ChangeEvent<T>>
export type KeyboardEventHandler<T = Element> = EventHandler<KeyboardEvent<T>>
export type MouseEventHandler<T = Element> = EventHandler<MouseEvent<T>>
export type TouchEventHandler<T = Element> = EventHandler<TouchEvent<T>>
export type PointerEventHandler<T = Element> = EventHandler<PointerEvent<T>>
export type UIEventHandler<T = Element> = EventHandler<UIEvent<T>>
export type WheelEventHandler<T = Element> = EventHandler<WheelEvent<T>>
export type AnimationEventHandler<T = Element> = EventHandler<AnimationEvent<T>>
export type TransitionEventHandler<T = Element> = EventHandler<TransitionEvent<T>>

// CSS
export interface CSSProperties {
  [key: string]: string | number | undefined
}

export type ReferrerPolicy =
  | ''
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url'

// Version
export const version: string
