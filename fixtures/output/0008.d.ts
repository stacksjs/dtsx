import type { CertDetails } from './types';

export declare function isCertValidForDomain(certPemOrPath: string, domain: string): boolean;
export declare function readCertFromFile(certPath: string): string;
export declare function parseCertDetails(certPemOrPath: string): CertDetails;
export declare function isCertExpired(certPemOrPath: string): boolean;
export declare function getCertificateFromCertPemOrPath(certPemOrPath: string): pki.Certificate;
export declare function listCertsInDirectory(dirPath?: string): string[];
export declare function makeNumberPositive(hexString: string): string;
export declare function findFoldersWithFile(rootDir: string, fileName: string): string[];
declare function search(dir: string): void;
export declare function debugLog(category: string, message: string, verbose?: boolean): void;