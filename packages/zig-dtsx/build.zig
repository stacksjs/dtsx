const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Shared library for FFI (needs libc for c_allocator)
    const lib = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "zig-dtsx",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/lib.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });
    // Enable LTO on Linux release builds (LLD required; macOS Mach-O doesn't support LLD)
    if (target.result.os.tag == .linux and optimize != .Debug) {
        lib.use_lld = true;
        lib.lto = .full;
    }
    // Strip debug symbols in release builds for smaller binary + faster loads
    if (optimize != .Debug) {
        lib.root_module.strip = true;
    }
    b.installArtifact(lib);

    // CLI binary (needs libc for C stdio)
    const exe = b.addExecutable(.{
        .name = "zig-dtsx",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });
    if (optimize != .Debug) {
        exe.root_module.strip = true;
    }
    b.installArtifact(exe);

    // CLI-only step (for cross-compilation without shared library)
    const cli_install = b.addInstallArtifact(exe, .{});
    const cli_step = b.step("cli", "Build only the CLI binary");
    cli_step.dependOn(&cli_install.step);

    // Run step
    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }
    const run_step = b.step("run", "Run the CLI");
    run_step.dependOn(&run_cmd.step);

    // Unit tests
    const test_targets = [_][]const u8{
        "src/char_utils.zig",
        "src/types.zig",
        "src/scanner.zig",
        "src/emitter.zig",
        "src/type_inference.zig",
    };

    const test_step = b.step("test", "Run unit tests");
    for (test_targets) |test_file| {
        const unit_test = b.addTest(.{
            .root_module = b.createModule(.{
                .root_source_file = b.path(test_file),
                .target = target,
                .optimize = optimize,
            }),
        });
        const run_unit_test = b.addRunArtifact(unit_test);
        test_step.dependOn(&run_unit_test.step);
    }
}
