import { registerPlugin } from '@capacitor/core'

export interface CloudFilePickResult {
  uri: string
  name: string
}

export interface CloudFileInfoResult {
  exists: boolean
  name: string | null
  size: number
  modifiedAt: string | null
}

export interface CloudFileReadResult {
  data: string // base64
}

export interface CloudFileWriteOptions {
  uri: string
  data: string // base64
}

export interface CloudFileWriteResult {
  success: boolean
  bytesWritten: number
  uri?: string
}

export interface CloudFolderPickResult {
  uri: string
}

export interface CloudFolderFile {
  name: string
  uri: string
  size: number
  modifiedAt: string | null
}

export interface CloudFolderWriteOptions {
  treeUri: string
  fileName: string
  data: string // base64
  mimeType?: string
}

export interface CloudFilePlugin {
  pickFile(options?: { mimeType?: string }): Promise<CloudFilePickResult>
  getFileInfo(options: { uri: string }): Promise<CloudFileInfoResult>
  readFile(options: { uri: string }): Promise<CloudFileReadResult>
  writeFile(options: CloudFileWriteOptions): Promise<CloudFileWriteResult>
  pickFolder(): Promise<CloudFolderPickResult>
  listFilesInFolder(options: { treeUri: string; extension?: string }): Promise<{ files: CloudFolderFile[] }>
  getFileInfoInFolder(options: { treeUri: string; fileName: string }): Promise<CloudFileInfoResult>
  readFileInFolder(options: { treeUri: string; fileName: string }): Promise<CloudFileReadResult>
  writeFileInFolder(options: CloudFolderWriteOptions): Promise<CloudFileWriteResult>
}

const CloudFile = registerPlugin<CloudFilePlugin>('CloudFile', {
  web: async () => {
    // Web fallback: not supported
    return {
      pickFile: async () => {
        throw new Error('CloudFile.pickFile is not supported on web')
      },
      getFileInfo: async () => {
        throw new Error('CloudFile.getFileInfo is not supported on web')
      },
      readFile: async () => {
        throw new Error('CloudFile.readFile is not supported on web')
      },
      writeFile: async () => {
        throw new Error('CloudFile.writeFile is not supported on web')
      },
      pickFolder: async () => {
        throw new Error('CloudFile.pickFolder is not supported on web')
      },
      listFilesInFolder: async () => {
        throw new Error('CloudFile.listFilesInFolder is not supported on web')
      },
      getFileInfoInFolder: async () => {
        throw new Error('CloudFile.getFileInfoInFolder is not supported on web')
      },
      readFileInFolder: async () => {
        throw new Error('CloudFile.readFileInFolder is not supported on web')
      },
      writeFileInFolder: async () => {
        throw new Error('CloudFile.writeFileInFolder is not supported on web')
      },
    }
  },
})

export default CloudFile
