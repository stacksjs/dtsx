import type { CAOptions, CertificateOptions, GenerateCertReturn, TlsOption } from './types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { log, runCommand } from '@stacksjs/cli'
import forge, { pki, tls } from 'node-forge'
import { config } from './config'
import { debugLog, findFoldersWithFile, makeNumberPositive } from './utils'

export interface Cert {
  certificate: string
  privateKey: string
}

/**
 * Generate a random serial number for the Certificate
 * @returns The serial number for the Certificate
 */
export function generateRandomSerial(verbose?: boolean): string {
  debugLog('cert', 'Generating random serial number', verbose)
  const serialNumber = makeNumberPositive(forge.util.bytesToHex(forge.random.getBytesSync(20)))
  debugLog('cert', `Generated serial number: ${serialNumber}`, verbose)
  return serialNumber
}

export function calculateValidityDates(options: {
  validityDays?: number
  validityYears?: number
  notBeforeDays?: number
  verbose?: boolean
}): { notBefore: Date, notAfter: Date } {
  const notBeforeDays = options.notBeforeDays ?? 2
  const validityDays = options.validityDays ?? (options.validityYears ? options.validityYears * 365 : 180)

  debugLog('cert', 'Calculating certificate validity dates', options.verbose)

  const notBefore = new Date(Date.now() - 60 * 60 * 24 * notBeforeDays * 1000)
  const notAfter = new Date(notBefore.getTime() + validityDays * 24 * 60 * 60 * 1000)

  // Normalize dates to midnight UTC
  notBefore.setUTCHours(0, 0, 0, 0)
  notAfter.setUTCHours(23, 59, 59, 999)

  debugLog('cert', `Validity period: ${notBefore.toISOString()} to ${notAfter.toISOString()}`, options.verbose)

  return { notBefore, notAfter }
}

function generateCertificateExtensions(options: CertificateOptions) {
  const extensions = []

  // Basic Constraints
  extensions.push({
    name: 'basicConstraints',
    cA: options.isCA ?? false,
    critical: true,
    ...(options.basicConstraints || {}),
  })

  // Key Usage
  if (options.keyUsage) {
    extensions.push({
      name: 'keyUsage',
      critical: true,
      ...options.keyUsage,
    })
  }

  // Extended Key Usage
  if (options.extKeyUsage) {
    extensions.push({
      name: 'extKeyUsage',
      ...options.extKeyUsage,
    })
  }

  // Subject Alt Names
  if (options.subjectAltNames && options.subjectAltNames.length > 0) {
    extensions.push({
      name: 'subjectAltName',
      altNames: options.subjectAltNames,
    })
  }

  return extensions
}

export async function createRootCA(options: CAOptions = {}): Promise<GenerateCertReturn> {
  debugLog('ca', 'Creating new Root CA Certificate', options.verbose)

  const keySize = options.keySize || 2048
  debugLog('ca', `Generating ${keySize}-bit RSA key pair`, options.verbose)
  const { privateKey, publicKey } = pki.rsa.generateKeyPair(keySize)

  const attributes = [
    { shortName: 'C', value: options.countryName || config.countryName },
    { shortName: 'ST', value: options.stateName || config.stateName },
    { shortName: 'L', value: options.localityName || config.localityName },
    { shortName: 'O', value: options.organization || 'Local Development CA' },
    { shortName: 'OU', value: options.organizationalUnit || 'Certificate Authority' },
    { shortName: 'CN', value: options.commonName || 'Local Development Root CA' },
    ...(options.extraAttributes || []),
  ]

  const { notBefore, notAfter } = calculateValidityDates({
    validityYears: options.validityYears || 100,
    verbose: options.verbose,
  })

  const caCert = pki.createCertificate()
  caCert.publicKey = publicKey
  caCert.serialNumber = generateRandomSerial(options.verbose)
  caCert.validity.notBefore = notBefore
  caCert.validity.notAfter = notAfter
  caCert.setSubject(attributes)
  caCert.setIssuer(attributes)

  caCert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true,
      critical: true,
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      critical: true,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ])

  caCert.sign(privateKey, forge.md.sha256.create())

  return {
    certificate: pki.certificateToPem(caCert),
    privateKey: pki.privateKeyToPem(privateKey),
    notBefore,
    notAfter,
  }
}

export async function generateCertificate(options: CertificateOptions): Promise<GenerateCertReturn> {
  debugLog('cert', 'Generating new certificate', options.verbose)
  debugLog('cert', `Options: ${JSON.stringify(options)}`, options.verbose)

  if (!options.rootCAObject?.certificate || !options.rootCAObject?.privateKey) {
    throw new Error('Root CA certificate and private key are required')
  }

  const caCert = pki.certificateFromPem(options.rootCAObject.certificate)
  const caKey = pki.privateKeyFromPem(options.rootCAObject.privateKey)

  debugLog('cert', 'Generating 2048-bit RSA key pair for host certificate', options?.verbose)
  const keySize = 2048
  // const keySize = options.keySize || 2048
  const { privateKey, publicKey } = pki.rsa.generateKeyPair(keySize)

  // Allow for custom certificate attributes
  const attributes = options.certificateAttributes || [
    { shortName: 'C', value: options.countryName || config.countryName },
    { shortName: 'ST', value: options.stateName || config.stateName },
    { shortName: 'L', value: options.localityName || config.localityName },
    { shortName: 'O', value: options.organizationName || config.organizationName },
    { shortName: 'CN', value: options.commonName || config.commonName },
  ]

  const { notBefore, notAfter } = calculateValidityDates({
    validityDays: options.validityDays,
    verbose: options.verbose,
  })

  const cert = pki.createCertificate()
  cert.publicKey = publicKey
  cert.serialNumber = generateRandomSerial(options.verbose)
  cert.validity.notBefore = notBefore
  cert.validity.notAfter = notAfter
  cert.setSubject(attributes)
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions(generateCertificateExtensions(options))
  cert.sign(caKey, forge.md.sha256.create())

  return {
    certificate: pki.certificateToPem(cert),
    privateKey: pki.privateKeyToPem(privateKey),
    notBefore,
    notAfter,
  }
}

/**
 * Add a certificate to the system trust store and save the certificate to a file
 * @param cert
 * @param caCert
 * @param options
 * @returns The path to the stored certificate
 */
export async function addCertToSystemTrustStoreAndSaveCert(cert: Cert, caCert: string, options?: TlsOption): Promise<string> {
  debugLog('trust', `Adding certificate to system trust store with options: ${JSON.stringify(options)}`, options?.verbose)
  debugLog('trust', 'Storing certificate and private key', options?.verbose)
  const certPath = storeCertificate(cert, options)

  debugLog('trust', 'Storing CA certificate', options?.verbose)
  const caCertPath = storeCACertificate(caCert, options)

  const platform = os.platform()
  debugLog('trust', `Detected platform: ${platform}`, options?.verbose)
  const args = 'TC, C, C'

  if (platform === 'darwin') {
    debugLog('trust', 'Adding certificate to macOS keychain', options?.verbose)
    await runCommand(
      `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${caCertPath}`,
    )
  }
  else if (platform === 'win32') {
    debugLog('trust', 'Adding certificate to Windows certificate store', options?.verbose)
    await runCommand(`certutil -f -v -addstore -enterprise Root ${caCertPath}`)
  }
  else if (platform === 'linux') {
    debugLog('trust', 'Adding certificate to Linux certificate store', options?.verbose)
    const rootDirectory = os.homedir()
    const targetFileName = 'cert9.db'
    debugLog('trust', `Searching for certificate databases in ${rootDirectory}`, options?.verbose)
    const foldersWithFile = findFoldersWithFile(rootDirectory, targetFileName)

    for (const folder of foldersWithFile) {
      debugLog('trust', `Processing certificate database in ${folder}`, options?.verbose)
      try {
        debugLog('trust', `Attempting to delete existing cert for ${config.commonName}`, options?.verbose)
        await runCommand(`certutil -d sql:${folder} -D -n ${config.commonName}`)
      }
      catch (error) {
        debugLog('trust', `Warning: Error deleting existing cert: ${error}`, options?.verbose)
        console.warn(`Error deleting existing cert: ${error}`)
      }

      debugLog('trust', `Adding new certificate to ${folder}`, options?.verbose)
      await runCommand(`certutil -d sql:${folder} -A -t ${args} -n ${config.commonName} -i ${caCertPath}`)

      log.info(`Cert added to ${folder}`)
    }
  }
  else {
    debugLog('trust', `Error: Unsupported platform ${platform}`, options?.verbose)
    throw new Error(`Unsupported platform: ${platform}`)
  }

  debugLog('trust', 'Certificate successfully added to system trust store', options?.verbose)
  return certPath
}

export function storeCertificate(cert: Cert, options?: TlsOption): string {
  debugLog('storage', `Storing certificate and private key with options: ${JSON.stringify(options)}`, options?.verbose)
  const certPath = options?.certPath || config.certPath
  const certKeyPath = options?.keyPath || config.keyPath

  debugLog('storage', `Certificate path: ${certPath}`, options?.verbose)
  debugLog('storage', `Private key path: ${certKeyPath}`, options?.verbose)

  // Ensure the directory exists before writing the file
  const certDir = path.dirname(certPath)
  if (!fs.existsSync(certDir)) {
    debugLog('storage', `Creating certificate directory: ${certDir}`, options?.verbose)
    fs.mkdirSync(certDir, { recursive: true })
  }

  debugLog('storage', 'Writing certificate file', options?.verbose)
  fs.writeFileSync(certPath, cert.certificate)

  // Ensure the directory exists before writing the file
  const certKeyDir = path.dirname(certKeyPath)
  if (!fs.existsSync(certKeyDir)) {
    debugLog('storage', `Creating private key directory: ${certKeyDir}`, options?.verbose)
    fs.mkdirSync(certKeyDir, { recursive: true })
  }

  debugLog('storage', 'Writing private key file', options?.verbose)
  fs.writeFileSync(certKeyPath, cert.privateKey)

  debugLog('storage', 'Certificate and private key stored successfully', options?.verbose)
  return certPath
}

/**
 * Store the CA Certificate
 * @param caCert - The CA Certificate
 * @param options - The options for storing the CA Certificate
 * @returns The path to the CA Certificate
 */
export function storeCACertificate(caCert: string, options?: TlsOption): string {
  debugLog('storage', 'Storing CA certificate', options?.verbose)
  const caCertPath = options?.caCertPath || config.caCertPath

  debugLog('storage', `CA certificate path: ${caCertPath}`, options?.verbose)

  // Ensure the directory exists before writing the file
  const caCertDir = path.dirname(caCertPath)
  if (!fs.existsSync(caCertDir)) {
    debugLog('storage', `Creating CA certificate directory: ${caCertDir}`, options?.verbose)
    fs.mkdirSync(caCertDir, { recursive: true })
  }

  debugLog('storage', 'Writing CA certificate file', options?.verbose)
  fs.writeFileSync(caCertPath, caCert)

  debugLog('storage', 'CA certificate stored successfully', options?.verbose)
  return caCertPath
}

export { forge, pki, tls }
