/**
 * **abseil.io** - Abseil Common Libraries (C++)
 *
 * @domain `abseil.io`
 * @version `20250512.0.0` (17 versions available)
 * @versions From newest version to oldest. @see https://ts-pkgx.netlify.app/packages/abseil-io.md
 *
 * @install `sh <(curl https://pkgx.sh) +abseil.io -- $SHELL -i`
 *
 * @example
 * ```typescript
 * import { pantry } from 'ts-pkgx'
 *
 * const pkg = pantry.abseilio
 * console.log(pkg.name)        // "abseil.io"
 * console.log(pkg.description) // "Abseil Common Libraries (C++)"
 * console.log(pkg.versions[0]) // "20250512.0.0" (latest)
 * ```
 *
 * @see https://ts-pkgx.netlify.app/packages/abseil-io.md
 * @see https://ts-pkgx.netlify.app/usage
 */
export declare const abseilioPackage: {
  /**
   * The display name of this package.
   */
  name: 'abseil.io';
  /**
   * The canonical domain name for this package.
   */
  domain: 'abseil.io';
  /**
   * Brief description of what this package does.
   */
  description: 'Abseil Common Libraries (C++)';
  packageYmlUrl: 'https://github.com/pkgxdev/pantry/tree/main/projects/abseil.io/package.yml';
  homepageUrl: '';
  githubUrl: 'https://github.com/pkgxdev/pantry/';
  /**
   * Command to install this package using pkgx.
   * @example sh <(curl https://pkgx.sh) +package-name
   */
  installCommand: 'sh <(curl https://pkgx.sh) +abseil.io -- $SHELL -i';
  programs: readonly [];
  companions: readonly [];
  dependencies: readonly [];
  /**
   * Available versions from newest to oldest.
   * @see https://ts-pkgx.netlify.app/usage for installation instructions
   */
  versions: readonly ['20250512.0.0', '20250127.1.0', '20250127.0.0', '20240722.1.0', '20240722.0.0', '20240116.3.0', '20240116.2.0', '20240116.1.0', '20240116.0.0', '20230802.3.0', '20230802.2.0', '20230802.1.0', '20230802.0.0', '20230125.4.0', '20230125.3.0', '20230125.2.0', '20220623.2.0'];
  aliases: readonly [];
  fullPath: 'abseil.io'
};
export type AbseilioPackage = typeof abseilioPackage
