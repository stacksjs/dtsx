import type { CertDetails } from './types';
/**
* Checks if a certificate is valid for a given domain.
* @param certPemOrPath - The certificate in PEM format or the path to the certificate file.
* @param domain - The domain to check.
* @returns {boolean} - True if the certificate is valid for the domain, false otherwise.
*/
export declare function isCertValidForDomain(certPemOrPath: string, domain: string): boolean;
/**
* Reads a certificate from a file.
* @param certPath - Path to the certificate file.
* @returns {string} - The certificate content.
*/
export declare function readCertFromFile(certPath: string): string;
/**
* Parses and extracts details from a certificate.
* @param certPemOrPath - The certificate in PEM format or the path to the certificate file.
* @returns {CertDetails} - An object containing certificate details.
*/
export declare function parseCertDetails(certPemOrPath: string): CertDetails;
/**
* Checks if a certificate is expired.
* @param certPemOrPath - The certificate in PEM format or the path to the certificate file.
* @returns {boolean} - True if the certificate is expired, false otherwise.
*/
export declare function isCertExpired(certPemOrPath: string): boolean;
/**
* Gets a certificate from a PEM string or a path to a certificate file.
* @param certPemOrPath - The certificate in PEM format or the path to the certificate file.
* @returns {pki.Certificate} - The certificate object.
*/
export declare function getCertificateFromCertPemOrPath(certPemOrPath: string): pki.Certificate;
/**
* Lists all certificates in a directory.
* By default, it returns the certificates stored in their default locations on each operating system.
* If no certificates are found in the default paths, it checks the fallback path.
* @param dirPath - Path to the directory. If not provided, the default directory for the OS will be used.
* @returns {string[]} - An array of certificate file paths.
*/
export declare function listCertsInDirectory(dirPath?: string): string[];
export declare function makeNumberPositive(hexString: string): string;
export declare function findFoldersWithFile(rootDir: string, fileName: string): string[];
export declare function debugLog(category: string, message: string, verbose?: boolean): void;
declare const cert: unknown;
declare const altNames: unknown;
declare const cert: unknown;
declare const cert: unknown;
declare const now: Date;
declare let certPem: string;
declare const platform: unknown;
declare let defaultDir: string;
declare const certFiles: (fs
    .readdirSync(defaultDir)
    .filter(file) => unknown;
// If no certificates are found in the default directory, check the fallback path
declare const stacksDir: (path.join(os.homedir(), '.stacks', 'ssl')
  certFiles.push(
    ...fs
      .readdirSync(stacksDir)
      .filter(file) => unknown;
declare let mostSignificativeHexDigitAsInt: unknown;
declare const result: string[];
declare const files: unknown;