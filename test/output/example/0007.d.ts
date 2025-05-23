import type { CAOptions, CertificateOptions, GenerateCertReturn, TlsOption } from './types';
/**
* Generate a random serial number for the Certificate
* @returns The serial number for the Certificate
*/
export declare function generateRandomSerial(verbose?: boolean): string;
export declare function calculateValidityDates(options: {
  validityDays?: number
  validityYears?: number
  notBeforeDays?: number
  verbose?: boolean
}): void;
declare function generateCertificateExtensions(options: CertificateOptions): void;
export declare async function createRootCA(options: CAOptions = {}): Promise<GenerateCertReturn>;
export declare async function generateCertificate(options: CertificateOptions): Promise<GenerateCertReturn>;
/**
* Add a certificate to the system trust store and save the certificate to a file
* @param cert
* @param caCert
* @param options
* @returns The path to the stored certificate
*/
export declare async function addCertToSystemTrustStoreAndSaveCert(cert: Cert, caCert: string, options?: TlsOption): Promise<string>;
export declare function storeCertificate(cert: Cert, options?: TlsOption): string;
/**
* Store the CA Certificate
* @param caCert - The CA Certificate
* @param options - The options for storing the CA Certificate
* @returns The path to the CA Certificate
*/
export declare function storeCACertificate(caCert: string, options?: TlsOption): string;
declare const serialNumber: unknown;
declare const notBeforeDays: unknown;
declare const validityDays: unknown;
declare const notBefore: Date;
declare const notAfter: Date;
declare const extensions: Array<never>;
declare const keySize: unknown;
declare const attributes: Array<{
  shortName: 'C';
  value: unknown
} | {
  shortName: 'ST';
  value: unknown
} | {
  shortName: 'L';
  value: unknown
} | {
  shortName: 'O';
  value: unknown
} | {
  shortName: 'OU';
  value: unknown
} | {
  shortName: 'CN';
  value: unknown
} | unknown>;
declare const caCert: unknown;
declare const caCert: unknown;
declare const caKey: unknown;
declare const keySize: 2048;
// Allow for custom certificate attributes
declare const attributes: unknown;
declare const cert: unknown;
declare const certPath: unknown;
declare const caCertPath: unknown;
declare const platform: unknown;
declare const args: unknown;
declare const certPath: unknown;
declare const certKeyPath: unknown;
// Ensure the directory exists before writing the file
declare const certDir: unknown;
// Ensure the directory exists before writing the file
declare const certKeyDir: unknown;
declare const caCertPath: unknown;
// Ensure the directory exists before writing the file
declare const caCertDir: unknown;
export declare interface Cert {
  certificate: string
  privateKey: string
}