import { forge, tls } from 'node-forge';
import { os } from 'node:os';
import type { CAOptions, CertificateOptions, GenerateCertReturn, TlsOption } from './types';
export declare function generateRandomSerial(verbose?: boolean): string;
export declare function calculateValidityDates(options: {
  validityDays?: number
  validityYears?: number
  notBeforeDays?: number
  verbose?: boolean
}): { notBefore: Date, notAfter: Date };
export declare function createRootCA(options: CAOptions): Promise<GenerateCertReturn>;
export declare function generateCertificate(options: CertificateOptions): Promise<GenerateCertReturn>;
export declare function addCertToSystemTrustStoreAndSaveCert(cert: Cert, caCert: string, options?: TlsOption): Promise<string>;
export declare function storeCertificate(cert: Cert, options?: TlsOption): string;
export declare function storeCACertificate(caCert: string, options?: TlsOption): string;
export declare interface Cert {
  certificate: string
  privateKey: string
}
export { forge, pki, tls };