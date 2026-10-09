import React, { useState, useRef } from 'react';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { EditorView } from './components/EditorView';
import { OrganizeView } from './components/OrganizeView';
import { ToolsView } from './components/ToolsView';
import { PdfDocument, ViewMode, ToolType } from './types';
import { uploadFiles } from './api/client';

export const App: React.FC = () => {
  const [documents, setDocuments] = useState<PdfDocument[]>([]);
  const [activeDoc, setActiveDoc] = useState<PdfDocument | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [activeTool, setActiveTool] = useState<ToolType>('merge');
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = async (files: File[]) => {
    try {
      setIsUploading(true);
      const uploadedDocs = await uploadFiles(files);
      setDocuments(prev => [...prev, ...uploadedDocs]);
      if (uploadedDocs.length > 0) {
        setActiveDoc(uploadedDocs[0]);
        setViewMode('editor');
      }
    } catch (err: any) {
      alert(`Error al subir archivos: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectDoc = (doc: PdfDocument) => {
    setActiveDoc(doc);
    if (viewMode === 'dashboard') {
      setViewMode('editor');
    }
  };

  const handleCloseDoc = (docId: string) => {
    setDocuments(prev => {
      const next = prev.filter(d => d.id !== docId);
      if (activeDoc?.id === docId) {
        setActiveDoc(next.length > 0 ? next[0] : null);
        if (next.length === 0) {
          setViewMode('dashboard');
        }
      }
      return next;
    });
  };

  const handleNavigate = (mode: ViewMode, tool?: ToolType) => {
    if (tool) setActiveTool(tool);
    setViewMode(mode);
  };

  const handleDocumentAdded = (newDoc: PdfDocument) => {
    setDocuments(prev => [...prev, newDoc]);
    setActiveDoc(newDoc);
  };

  const handleDocumentUpdated = () => {
    // Force refresh document state
    if (activeDoc) {
      setActiveDoc({ ...activeDoc });
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-magic-bg text-gray-100 font-sans">
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files) handleFilesSelected(Array.from(e.target.files));
        }}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      <Header
        documents={documents}
        activeDoc={activeDoc}
        onSelectDoc={handleSelectDoc}
        onCloseDoc={handleCloseDoc}
        onUploadClick={() => fileInputRef.current?.click()}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <main className="flex-1 flex overflow-hidden relative">
        {viewMode === 'dashboard' && (
          <DashboardView
            onFilesSelected={handleFilesSelected}
            documents={documents}
            onSelectDoc={handleSelectDoc}
            onNavigate={handleNavigate}
            isUploading={isUploading}
          />
        )}

        {viewMode === 'editor' && activeDoc && (
          <EditorView
            document={activeDoc}
            onDocumentUpdated={handleDocumentUpdated}
          />
        )}

        {viewMode === 'organize' && activeDoc && (
          <OrganizeView
            document={activeDoc}
            onDocumentUpdated={handleDocumentUpdated}
          />
        )}

        {viewMode === 'tools' && (
          <ToolsView
            initialTool={activeTool}
            activeDoc={activeDoc}
            documents={documents}
            onDocumentAdded={handleDocumentAdded}
            onDocumentUpdated={handleDocumentUpdated}
          />
        )}
      </main>
    </div>
  );
};
