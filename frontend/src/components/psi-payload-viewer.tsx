import { useState, useEffect, useMemo } from 'react';
import { Search, Folder, File, ChevronRight, ChevronDown, Copy, Check, FileJson, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PsiPayloadFile {
    key: string;
    folder: string;
    filename: string;
    lastModified: string;
    size: number;
}

interface FileTree {
    [folder: string]: PsiPayloadFile[];
}

interface PsiPayloadViewerProps {
    appName: string;
    environment: 'qa' | 'dev' | 'prod';
}

export default function PsiPayloadViewer({ appName, environment }: PsiPayloadViewerProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [files, setFiles] = useState<PsiPayloadFile[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [selectedFile, setSelectedFile] = useState<PsiPayloadFile | null>(null);

    const [contentLoading, setContentLoading] = useState(false);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [contentError, setContentError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const [leftWidth, setLeftWidth] = useState(320);
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            // min width 200, max width window.innerWidth - 300
            const newWidth = Math.max(200, Math.min(e.clientX, window.innerWidth - 300));
            setLeftWidth(newWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            // Prevent text selection while resizing
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.userSelect = '';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = '';
        };
    }, [isResizing]);

    useEffect(() => {
        loadFiles();
    }, [appName, environment]);

    const loadFiles = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/s3/payloads?env=${environment}`);
            if (!res.ok) {
                throw new Error('Failed to fetch payloads from S3');
            }
            const data = await res.json();
            setFiles(data);
            // Auto-expand first folder
            if (data.length > 0) {
                setExpandedFolders(new Set([data[0].folder]));
            }
        } catch (err: any) {
            setError(err.message || 'Unknown error fetching payloads');
        } finally {
            setLoading(false);
        }
    };

    const loadContent = async (file: PsiPayloadFile) => {
        setContentLoading(true);
        setContentError(null);
        setFileContent(null);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/s3/payload-content?env=${environment}&key=${encodeURIComponent(file.key)}`);
            if (!res.ok) {
                throw new Error('Failed to fetch file content');
            }
            const text = await res.text();
            setFileContent(text);
        } catch (err: any) {
            setContentError(err.message || 'Unknown error');
        } finally {
            setContentLoading(false);
        }
    };

    const handleSelectFile = (file: PsiPayloadFile) => {
        setSelectedFile(file);
        loadContent(file);
    };

    const toggleFolder = (folder: string) => {
        setExpandedFolders((prev: Set<string>) => {
            const next = new Set(prev);
            if (next.has(folder)) {
                next.delete(folder);
            } else {
                next.add(folder);
                // Auto-select summary file if exists
                const summaryFile = (tree as FileTree)[folder]?.find(f =>
                    f.filename.toLowerCase().includes('summary')
                );
                if (summaryFile) {
                    handleSelectFile(summaryFile);
                }
            }
            return next;
        });
    };

    const copyToClipboard = async () => {
        if (!fileContent) return;
        try {
            await navigator.clipboard.writeText(fileContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    // Group and filter files
    const tree = useMemo(() => {
        let filtered = files;
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            filtered = files.filter((f: PsiPayloadFile) =>
                f.filename.toLowerCase().includes(lower) ||
                f.folder.toLowerCase().includes(lower)
            );
        }

        const grouped: FileTree = {};
        for (const f of filtered) {
            if (!grouped[f.folder]) {
                grouped[f.folder] = [];
            }
            grouped[f.folder].push(f);
        }
        return grouped;
    }, [files, searchTerm]);

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else return (bytes / 1048576).toFixed(1) + ' MB';
    };

    const formatDate = (isoString: string) => {
        const d = new Date(isoString);
        return d.toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-[#1a1a1a]">
                <div className="flex flex-col items-center gap-3 text-gray-400">
                    <div className="w-6 h-6 border-2 border-[#333] border-t-blue-500 rounded-full animate-spin" />
                    Loading PSI payloads from S3...
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-full items-center justify-center p-8 bg-[#1a1a1a]">
                <div className="bg-red-900/20 border border-red-900/50 p-6 rounded-xl text-red-400 max-w-md w-full flex flex-col items-center gap-3">
                    <AlertCircle className="w-8 h-8 opacity-80" />
                    <p className="text-center">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full bg-[#1a1a1a] overflow-hidden">
            {/* Left Panel: Tree View */}
            <div
                className="border-r border-[#333] flex flex-col bg-[#1e1e1e] flex-shrink-0"
                style={{ width: leftWidth }}
            >
                <div className="p-4 border-b border-[#333]">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            placeholder="Search folders or files..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-[#252525] border border-[#404040] rounded-lg pl-9 pr-9 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    {Object.entries(tree).length === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm italic">
                            No files found.
                        </div>
                    ) : (
                        Object.entries(tree as FileTree).map(([folder, folderFiles]: [string, PsiPayloadFile[]]) => {
                            const isExpanded = expandedFolders.has(folder);
                            return (
                                <div key={folder} className="mb-1">
                                    <button
                                        onClick={() => toggleFolder(folder)}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#333] rounded text-left transition-colors group"
                                    >
                                        <span className="text-gray-500 group-hover:text-gray-300">
                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </span>
                                        <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                        <span className="text-sm font-semibold text-gray-300 truncate">{folder || 'Root'}</span>
                                        <span className="ml-auto text-xs text-gray-500 bg-[#252525] px-1.5 py-0.5 rounded">{folderFiles.length}</span>
                                    </button>

                                    {isExpanded && (
                                        <div className="ml-3 pl-3 border-l border-[#333] mt-1 space-y-0.5">
                                            {folderFiles.map(file => {
                                                const isSelected = selectedFile?.key === file.key;
                                                return (
                                                    <button
                                                        key={file.key}
                                                        onClick={() => handleSelectFile(file)}
                                                        className={cn(
                                                            "w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors text-sm",
                                                            isSelected
                                                                ? "bg-blue-500/20 text-blue-400 font-medium"
                                                                : "text-gray-400 hover:bg-[#333] hover:text-gray-200"
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-2 truncate">
                                                            <FileJson className={cn("w-3.5 h-3.5 flex-shrink-0", isSelected ? "text-blue-400" : "text-gray-500")} />
                                                            <span className="truncate">{file.filename}</span>
                                                        </div>
                                                        <div className="flex flex-col items-end flex-shrink-0 ml-2">
                                                            <span className="text-[10px] opacity-70">{formatSize(file.size)}</span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Resizer */}
            <div
                className="w-1 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 flex-shrink-0 z-10 border-l border-transparent hover:border-[#444] transition-colors"
                onMouseDown={(e) => {
                    e.preventDefault();
                    setIsResizing(true);
                }}
            />

            {/* Main Panel: Preview */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e]">
                {selectedFile ? (
                    <>
                        <div className="flex items-center justify-between p-4 border-b border-[#333] bg-[#252525]">
                            <div className="flex items-center gap-3 truncate">
                                <File className="w-5 h-5 text-gray-400" />
                                <div className="truncate">
                                    <h3 className="text-white font-mono text-sm font-semibold truncate">{selectedFile.filename}</h3>
                                    <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                                        <span>{formatDate(selectedFile.lastModified)}</span>
                                        <span>{formatSize(selectedFile.size)}</span>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={copyToClipboard}
                                disabled={contentLoading || !fileContent}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all",
                                    copied
                                        ? "bg-green-500/20 text-green-400"
                                        : "bg-[#333] hover:bg-[#444] text-gray-300"
                                )}
                            >
                                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-4 bg-[#141414]">
                            {contentLoading ? (
                                <div className="flex items-center justify-center h-full text-gray-500">
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-[#333] border-t-gray-500 rounded-full animate-spin" />
                                        Loading content...
                                    </div>
                                </div>
                            ) : contentError ? (
                                <div className="text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-900/50">
                                    Failed to load content: {contentError}
                                </div>
                            ) : (
                                <pre className="text-sm font-mono text-gray-300 leading-relaxed break-all whitespace-pre-wrap">
                                    {fileContent}
                                </pre>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
                        <FileJson className="w-16 h-16 opacity-20" />
                        <p>Select a file from the tree to view its content.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
