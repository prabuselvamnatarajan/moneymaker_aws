/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, ChevronDown, Upload, Download, Plus, Trash2, ArrowLeft, HardDrive, FileText } from 'lucide-react';
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
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

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

  const handleFileUpload = async () => {
    if (!uploadFile || !selectedVolume) return;
    
    setIsUploading(true);
    try {
      await api.volumes.uploadFile(selectedVolume.name, currentPath, uploadFile);
      showSuccess(`File "${uploadFile.name}" uploaded successfully`);
      setUploadFile(null);
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
      
      showSuccess(`File "${file.name}" downloaded successfully`);
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
      
      showSuccess(`Folder "${dir.name}" downloaded successfully`);
    } catch (err: any) {
      showError(`Failed to download folder: ${err.message}`);
    }
  };

  const handleDeleteFile = async (file: VolumeFile) => {
    if (!selectedVolume || !confirm(`Are you sure you want to delete "${file.name}"?`)) return;
    
    try {
      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      if (file.type === 'directory') {
        await api.volumes.deleteDirectory(selectedVolume.name, filePath);
      } else {
        await api.volumes.deleteFile(selectedVolume.name, filePath);
      }
      showSuccess(`${file.type === 'directory' ? 'Folder' : 'File'} "${file.name}" deleted successfully`);
      loadFiles(selectedVolume.name, currentPath);
    } catch (err: any) {
      showError(`Failed to delete: ${err.message}`);
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

  // Render volume list view
  if (!selectedVolume) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">Docker Volumes</h1>
          <p className="text-slate-400 text-sm">Browse and manage Docker volumes associated with your application</p>
        </div>

        {isLoading && !volumes.length ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {volumes.map((volume) => (
              <div
                key={volume.id}
                onClick={() => handleSelectVolume(volume)}
                className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 cursor-pointer hover:border-indigo-500/50 hover:bg-slate-900 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-indigo-500/20 transition-colors">
                    <HardDrive className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{volume.name}</h3>
                    <p className="text-xs text-slate-500 mt-1 font-mono">{volume.driver}</p>
                    {volume.size !== undefined && (
                      <p className="text-xs text-slate-400 mt-1">{formatFileSize(volume.size)}</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors shrink-0" />
                </div>
              </div>
            ))}
            
            {volumes.length === 0 && (
              <div className="col-span-full text-center py-12">
                <HardDrive className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No volumes found</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Render file browser view
  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => setSelectedVolume(null)}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Volumes
        </button>
        
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{selectedVolume.name}</h1>
            <p className="text-slate-400 text-sm font-mono">{selectedVolume.mountpoint || '/'}</p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* New Folder Button */}
            <button
              onClick={() => setShowNewFolderModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Folder
            </button>
            
            {/* Upload File Button */}
            <label className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              Upload File
              <input
                type="file"
                className="hidden"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                disabled={isUploading}
              />
            </label>
            
            {uploadFile && (
              <button
                onClick={handleFileUpload}
                disabled={isUploading}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm transition-colors disabled:opacity-50"
              >
                {isUploading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Upload
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Breadcrumb Navigation */}
      {currentPath && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <button
            onClick={handleNavigateUp}
            className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            ..
          </button>
          <span className="text-slate-600">/</span>
          {currentPath.split('/').map((part, index) => {
            const pathSoFar = currentPath.split('/').slice(0, index + 1).join('/');
            return (
              <React.Fragment key={pathSoFar}>
                <button
                  onClick={() => {
                    setCurrentPath(pathSoFar);
                    loadFiles(selectedVolume.name, pathSoFar);
                  }}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {part}
                </button>
                {index < currentPath.split('/').length - 1 && (
                  <span className="text-slate-600">/</span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Files List */}
      {isLoading && !files.length ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
      ) : (
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-slate-900 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <div className="col-span-6">Name</div>
            <div className="col-span-2">Size</div>
            <div className="col-span-3">Modified</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          
          <div className="divide-y divide-slate-800">
            {files.map((file) => (
              <div
                key={file.path}
                className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-slate-800/50 transition-colors group"
              >
                <div className="col-span-6 flex items-center gap-3 min-w-0">
                  {file.type === 'directory' ? (
                    <Folder 
                      className="w-5 h-5 text-indigo-400 shrink-0 cursor-pointer hover:text-indigo-300"
                      onClick={() => handleNavigateToFolder(file)}
                    />
                  ) : (
                    <File className="w-5 h-5 text-slate-400 shrink-0" />
                  )}
                  
                  {file.isParent ? (
                    <button
                      onClick={handleNavigateUp}
                      className="text-slate-400 hover:text-white text-sm truncate text-left"
                    >
                      Parent Directory
                    </button>
                  ) : (
                    <button
                      onClick={() => file.type === 'directory' ? handleNavigateToFolder(file) : null}
                      className={`text-sm truncate text-left ${
                        file.type === 'directory' 
                          ? 'text-white hover:text-indigo-400 cursor-pointer' 
                          : 'text-slate-300'
                      }`}
                      title={file.path}
                    >
                      {file.name}
                    </button>
                  )}
                </div>
                
                <div className="col-span-2 text-sm text-slate-400 font-mono">
                  {file.type === 'directory' ? '-' : formatFileSize(file.size)}
                </div>
                
                <div className="col-span-3 text-sm text-slate-400">
                  {formatDate(file.modifiedAt)}
                </div>
                
                <div className="col-span-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {file.type === 'file' && (
                    <button
                      onClick={() => handleDownloadFile(file)}
                      className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded transition-colors"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                  
                  {file.type === 'directory' && (
                    <button
                      onClick={() => handleDownloadDirectory(file)}
                      className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded transition-colors"
                      title="Download as ZIP"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleDeleteFile(file)}
                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            
            {files.length === 0 && (
              <div className="py-12 text-center">
                <FileText className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">This folder is empty</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-white mb-4">Create New Folder</h2>
            
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateDirectory()}
            />
            
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName('');
                }}
                className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDirectory}
                disabled={!newFolderName.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors disabled:opacity-50"
              >
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
