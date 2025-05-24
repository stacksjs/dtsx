import forge, { pki, tls } from 'node-forge';
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
}): { notBefore: Date, notAfter: Date };
export declare function createRootCA(options?: CAOptions): Promise<GenerateCertReturn>;
export declare function generateCertificate(options: CertificateOptions): Promise<GenerateCertReturn>;
/**
 * Add a certificate to the system trust store and save the certificate to a file
 * @param cert
 * @param caCert
 * @param options
 * @returns The path to the stored certificate
 */
export declare function addCertToSystemTrustStoreAndSaveCert(cert: Cert, caCert: string, options?: TlsOption): Promise<string>;
export declare function storeCertificate(cert: Cert, options?: TlsOption): string;
/**
 * Store the CA Certificate
 * @param caCert - The CA Certificate
 * @param options - The options for storing the CA Certificate
 * @returns The path to the CA Certificate
 */
export declare function storeCACertificate(caCert: string, options?: TlsOption): string;
export declare interface Cert {
  certificate: string
  privateKey: string
}
export { forge, pki, tls };