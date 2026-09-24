import type { DatasetFile, Direction, InvoiceDocument } from '../../shared/models/index.js';

type WritableLike = { write(data: Blob | string): Promise<void>; close(): Promise<void> };
type FileHandleLike = { createWritable(): Promise<WritableLike> };
type DirectoryHandleLike = {
  name: string;
  requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
};

declare global {
  interface Window { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>; }
}

const DB_NAME = 'hddt-public-workspace';
const STORE = 'handles';
const HANDLE_KEY = 'data-root';
let memoryHandle: DirectoryHandleLike | null = null;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeHandle(handle: DirectoryHandleLike): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadHandle(): Promise<DirectoryHandleLike | null> {
  if (memoryHandle) return memoryHandle;
  try {
    const db = await database();
    const value = await new Promise<DirectoryHandleLike | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result as DirectoryHandleLike | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    memoryHandle = value ?? null;
  } catch {
    memoryHandle = null;
  }
  return memoryHandle;
}

async function writableRoot(): Promise<DirectoryHandleLike | null> {
  const handle = await loadHandle();
  if (!handle) return null;
  const current = await handle.queryPermission({ mode: 'readwrite' });
  if (current === 'granted') return handle;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted' ? handle : null;
}

function fallbackDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function saveBlobToWorkspace(blob: Blob, fileName: string, taxCode?: string): Promise<'workspace' | 'download'> {
  const root = await writableRoot();
  if (!root) {
    fallbackDownload(blob, fileName);
    return 'download';
  }
  const directory = taxCode
    ? await root.getDirectoryHandle(taxCode.replace(/[^0-9-]/g, ''), { create: true })
    : root;
  const handle = await directory.getFileHandle(fileName.replace(/[\\/:*?"<>|]/g, '_'), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return 'workspace';
}

function datasetFileName(direction: Direction, fromDate: string, toDate: string): string {
  return `HDDT_${direction === 'purchase' ? 'PURCHASE' : 'SALES'}_${fromDate.replace(/-/g, '')}_${toDate.replace(/-/g, '')}.json`;
}

export const localWorkspace = {
  supported: () => typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined',
  currentName: async () => (await loadHandle())?.name ?? null,
  choose: async (): Promise<string> => {
    if (!window.showDirectoryPicker) throw new Error('Trình duyệt chưa hỗ trợ chọn thư mục. Ứng dụng sẽ dùng hộp tải file của trình duyệt.');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Chưa được cấp quyền ghi thư mục.');
    memoryHandle = handle;
    await storeHandle(handle);
    return handle.name;
  },
  saveBlob: saveBlobToWorkspace,
  saveDataset: async (input: { accountTaxCode: string; direction: Direction; fromDate: string; toDate: string; documents: InvoiceDocument[] }) => {
    const dataset: DatasetFile = {
      format: 'hddt-dataset', schemaVersion: 1, appVersion: '1.3.0-rc.2-public',
      meta: {
        accountTaxCode: input.accountTaxCode, direction: input.direction, fromDate: input.fromDate, toDate: input.toDate,
        createdAt: new Date().toISOString(), source: 'hoadondientu.gdt.gov.vn', recordCount: input.documents.length,
        detailCount: input.documents.filter((item) => item.lines.length > 0).length,
        sourceCounts: {
          standard: input.documents.filter((item) => (item.invoiceSource ?? 'standard') === 'standard').length,
          pos: input.documents.filter((item) => item.invoiceSource === 'pos').length,
        },
      },
      documents: input.documents.map((document) => ({
        key: document.key,
        normalized: { ...structuredClone(document), rawSummary: undefined, rawDetail: undefined },
        rawSummary: document.rawSummary,
        rawDetail: document.rawDetail,
      })),
    };
    const fileName = datasetFileName(input.direction, input.fromDate, input.toDate);
    const destination = await saveBlobToWorkspace(new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' }), fileName, input.accountTaxCode);
    return { fileName, destination };
  },
};
