# Native engine libraries

Release builds place the native declaration engine for each platform here
(`<platform>-<arch>/libzig-dtsx.{dylib,so}` or `zig-dtsx.dll`). The SDK loads
the one for the running platform in-process through Bun FFI and uses its
TypeScript engine when none applies.
