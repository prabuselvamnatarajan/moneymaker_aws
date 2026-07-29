/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, File, ChevronRight, Upload, Download, Plus, Trash2, 
  ArrowLeft, HardDrive, FileText, RefreshCw, Layers
} from 'lucide-react';
import { useToast } from './Toast';
import { api } from '../api';
import { VolumeInfo, VolumeFile } from '../types';

interface VolumesViewProps {
  onSelectVolume?: (volumeName: string) => void;
}

export default function VolumesView({ onSelectVolume }: VolumesViewProps) {
  const { showError, showSuccess } = useToast();
  
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [selectedVolume, setSelectedVolume] = useState<VolumeInfo | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<VolumeFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  // Modals & Inputs
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VolumeFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Drag & drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load all volumes on mount
  useEffect(() => {
    loadVolumes();
  }, []);

  const loadVolumes = async () => {
    setIsLoading(true);
    try {
      const res = await api.volumes.list();
      setVolumes(res.items || []);
    } catch (err: any) {
      showError(`Failed to load volumes: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadFiles = async (volumeName: string, path: string = '') => {
    setIsLoading(true);
    try {
      const res = await api.volumes.getFiles(volumeName, path);
      setFiles(res.items || []);
    } catch (err: any) {
      showError(`Failed to load files: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectVolume = (volume: VolumeInfo) => {
    setSelectedVolume(volume);
    setCurrentPath('');
    loadFiles(volume.name, '');
    if (onSelectVolume) {
      onSelectVolume(volume.name);
    }
  };

  const handleNavigateToFolder = (folder: VolumeFile) => {
    const newPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
    setCurrentPath(newPath);
    loadFiles(selectedVolume!.name, newPath);
  };

  const handleNavigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    const newPath = parts.join('/');
    setCurrentPath(newPath);
    loadFiles(selectedVolume!.name, newPath);
  };

  const handleCreateDirectory = async () => {
    if (!newFolderName.trim() || !selectedVolume) return;
    
    try {
      await api.volumes.createDirectory(selectedVolume.name, currentPath, newFolderName.trim());
      showSuccess(`Folder "${newFolderName}" created successfully`);
      setNewFolderName('');
      setShowNewFolderModal(false);
      loadFiles(selectedVolume.name, currentPath);
    } catch (err: any) {
      showError(`Failed to create folder: ${err.message}`);
    }
  };

  const handleFileUpload = async (fileToUpload?: File) => {
    const file = fileToUpload || uploadFile;
    if (!file || !selectedVolume) return;
    
    setIsUploading(true);
    try {
      await api.volumes.uploadFile(selectedVolume.name, currentPath, file);
      showSuccess(`File "${file.name}" uploaded successfully`);
      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      loadFiles(selectedVolume.name, currentPath);
    } catch (err: any) {
      showError(`Failed to upload file: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadFile = async (file: VolumeFile) => {
    if (!selectedVolume) return;
    
    try {
      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      const blob = await api.volumes.downloadFile(selectedVolume.name, filePath);
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      showSuccess(`File "${file.name}" exported successfully`);
    } catch (err: any) {
      showError(`Failed to download file: ${err.message}`);
    }
  };

  const handleDownloadDirectory = async (dir: VolumeFile) => {
    if (!selectedVolume) return;
    
    try {
      const dirPath = currentPath ? `${currentPath}/${dir.name}` : dir.name;
      const blob = await api.volumes.downloadDirectory(selectedVolume.name, dirPath);
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dir.name}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      showSuccess(`Folder "${dir.name}" exported as ZIP successfully`);
    } catch (err: any) {
      showError(`Failed to export folder: ${err.message}`);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedVolume || !deleteTarget) return;
    
    setIsDeleting(true);
    try {
      const itemPath = currentPath ? `${currentPath}/${deleteTarget.name}` : deleteTarget.name;
      if (deleteTarget.type === 'directory') {
        await api.volumes.deleteDirectory(selectedVolume.name, itemPath);
      } else {
        await api.volumes.deleteFile(selectedVolume.name, itemPath);
      }
      showSuccess(`${deleteTarget.type === 'directory' ? 'Folder' : 'File'} "${deleteTarget.name}" deleted successfully`);
      setDeleteTarget(null);
      loadFiles(selectedVolume.name, currentPath);
    } catch (err: any) {
      showError(`Failed to delete: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      setUploadFile(droppedFile);
      await handleFileUpload(droppedFile);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (bytes === undefined) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  // Render Volume Selection Cards Grid
  if (!selectedVolume) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white">Docker Volumes</h1>
              <span className="text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">
                ADMIN CONSOLE
              </span>
            </div>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Browse, import, export, and manage Docker Swarm persistent storage volumes
            </p>
          </div>

          <button
            onClick={loadVolumes}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-all cursor-pointer"
            title="Refresh Volume List"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {isLoading && !volumes.length ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {volumes.map((volume) => (
              <div
                key={volume.id}
                onClick={() => handleSelectVolume(volume)}
                className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 cursor-pointer hover:border-indigo-500/50 hover:bg-slate-900 transition-all group shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                      <HardDrive className="w-5 h-5 text-purple-400" />
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                  </div>

                  <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                    {volume.name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-1 truncate" title={volume.mountpoint}>
                    {volume.mountpoint || '/'}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500 font-mono">
                  <span>Driver: {volume.driver}</span>
                  {volume.size !== undefined && <span>{formatFileSize(volume.size)}</span>}
                </div>
              </div>
            ))}
            
            {volumes.length === 0 && (
              <div className="col-span-full bg-slate-900/40 border border-slate-800 rounded-xl text-center py-16">
                <HardDrive className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-400 text-sm font-semibold">No active Docker volumes discovered</p>
                <p className="text-slate-500 text-xs mt-1">Ensure Docker container volumes are mounted</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Render File Browser & Directory Tree View
  return (
    <div 
      className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 bg-indigo-950/80 backdrop-blur-sm border-4 border-dashed border-indigo-500 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
          <Upload className="w-16 h-16 text-indigo-400 animate-bounce mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Drop File to Upload</h2>
          <p className="text-indigo-200 text-sm">Target destination: /{currentPath || selectedVolume.name}</p>
        </div>
      )}

      {/* Header */}
      <div>
        <button
          onClick={() => setSelectedVolume(null)}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-xs sm:text-sm mb-3 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Volume Directory</span>
        </button>
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{selectedVolume.name}</h1>
              <span className="text-[10px] font-mono bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">
                {selectedVolume.driver}
              </span>
            </div>
            <p className="text-slate-400 text-xs font-mono mt-1 truncate">{selectedVolume.mountpoint}</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Refresh Button */}
            <button
              onClick={() => loadFiles(selectedVolume.name, currentPath)}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* New Folder Button */}
            <button
              onClick={() => setShowNewFolderModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Folder</span>
            </button>
            
            {/* Upload File Button */}
            <label className="flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-sm">
              <Upload className="w-4 h-4" />
              <span>Import File</span>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0] || null;
                  if (selected) {
                    setUploadFile(selected);
                    handleFileUpload(selected);
                  }
                }}
                disabled={isUploading}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Multi-level Breadcrumb Navigation */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-4 py-2.5 flex items-center gap-2 text-xs overflow-x-auto scrollbar-none">
        <button
          onClick={() => {
            setCurrentPath('');
            loadFiles(selectedVolume.name, '');
          }}
          className={`flex items-center gap-1.5 font-bold transition-colors cursor-pointer ${
            !currentPath ? 'text-indigo-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <HardDrive className="w-3.5 h-3.5" />
          <span>{selectedVolume.name}</span>
        </button>

        {currentPath && (
          <>
            <span className="text-slate-600">/</span>
            <button
              onClick={handleNavigateUp}
              className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer font-mono"
              title="Navigate Up"
            >
              ..
            </button>
          </>
        )}

        {currentPath && currentPath.split('/').map((part, index) => {
          const pathSoFar = currentPath.split('/').slice(0, index + 1).join('/');
          const isLast = index === currentPath.split('/').length - 1;
          return (
            <React.Fragment key={pathSoFar}>
              <span className="text-slate-600">/</span>
              <button
                onClick={() => {
                  setCurrentPath(pathSoFar);
                  loadFiles(selectedVolume.name, pathSoFar);
                }}
                className={`font-mono transition-colors cursor-pointer ${
                  isLast ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {part}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Files List Table */}
      {isLoading && !files.length ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 w-32">Size</th>
                  <th className="px-4 py-3 w-48">Last Modified</th>
                  <th className="px-4 py-3 w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {files.map((file) => (
                  <tr
                    key={file.path}
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {file.type === 'directory' ? (
                          <Folder 
                            className="w-4 h-4 text-indigo-400 shrink-0 cursor-pointer hover:text-indigo-300"
                            onClick={() => handleNavigateToFolder(file)}
                          />
                        ) : (
                          <File className="w-4 h-4 text-slate-400 shrink-0" />
                        )}

                        <button
                          onClick={() => file.type === 'directory' ? handleNavigateToFolder(file) : null}
                          className={`truncate text-left cursor-pointer transition-colors ${
                            file.type === 'directory' 
                              ? 'text-white hover:text-indigo-400 font-semibold' 
                              : 'text-slate-300 hover:text-white font-mono'
                          }`}
                          title={file.name}
                        >
                          {file.name}
                        </button>
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-slate-400">
                      {file.type === 'directory' ? '-' : formatFileSize(file.size)}
                    </td>

                    <td className="px-4 py-3 text-slate-400 font-mono">
                      {formatDate(file.modifiedAt)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        {file.type === 'file' ? (
                          <button
                            onClick={() => handleDownloadFile(file)}
                            className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Export / Download File"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDownloadDirectory(file)}
                            className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Export Folder as ZIP Archive"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => setDeleteTarget(file)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                          title="Delete Item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {files.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-16 text-center">
                      <FileText className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                      <p className="text-slate-400 text-sm font-semibold">Folder is empty</p>
                      <p className="text-slate-500 text-xs mt-1">Import files or create subfolders to get started</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Create New Directory</h2>
            <p className="text-xs text-slate-400 font-mono">
              Target location: /{currentPath || selectedVolume.name}
            </p>

            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name (e.g. backtest_exports)"
              className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateDirectory()}
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName('');
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDirectory}
                disabled={!newFolderName.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Confirm Delete</h2>
            <p className="text-slate-300 text-sm">
              Are you sure you want to delete <span className="font-bold text-rose-400 font-mono">"{deleteTarget.name}"</span>?
              {deleteTarget.type === 'directory' && ' All contained files and subfolders will be permanently removed.'}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isDeleting ? (
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
