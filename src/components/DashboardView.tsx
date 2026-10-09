import React, { useRef, useState } from 'react';
import { 
  UploadCloud, 
  FileText, 
  Layers, 
  FilePlus2, 
  Scissors, 
  PenTool, 
  Lock, 
  Sparkles, 
  ArrowRight,
  ShieldCheck,
  Zap,
  CheckCircle2
} from 'lucide-react';
import { PdfDocument, ViewMode, ToolType } from '../types';

interface DashboardViewProps {
  onFilesSelected: (files: File[]) => void;
  documents: PdfDocument[];
  onSelectDoc: (doc: PdfDocument) => void;
  onNavigate: (mode: ViewMode, tool?: ToolType) => void;
  isUploading: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onFilesSelected,
  documents,
  onSelectDoc,
  onNavigate,
  isUploading,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const pdfFiles = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.pdf'));
      if (pdfFiles.length > 0) {
        onFilesSelected(pdfFiles);
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const pdfFiles = Array.from(e.target.files);
      onFilesSelected(pdfFiles);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const tools = [
    {
      id: 'edit',
      title: 'Editar Texto e Imágenes',
      description: 'Haz clic sobre cualquier párrafo para reescribir texto, cambiar fuente, tamaño y colores.',
      icon: FileText,
      color: 'from-blue-500 to-indigo-600',
      action: () => onNavigate('editor'),
    },
    {
      id: 'organize',
      title: 'Organizar Páginas',
      description: 'Reordena hojas como tarjetas visuales, rótalas 90°, elimínalas o extráelas.',
      icon: Layers,
      color: 'from-purple-500 to-pink-600',
      action: () => onNavigate('organize'),
    },
    {
      id: 'merge',
      title: 'Unir Documentos (Merge)',
      description: 'Combina varios PDFs en uno solo con un clic manteniendo bookmarks y enlaces.',
      icon: FilePlus2,
      color: 'from-emerald-500 to-teal-600',
      action: () => onNavigate('tools', 'merge'),
    },
    {
      id: 'split',
      title: 'Dividir y Extraer (Split)',
      description: 'Separa un documento por rangos de páginas o divídelo en archivos individuales.',
      icon: Scissors,
      color: 'from-amber-500 to-orange-600',
      action: () => onNavigate('tools', 'split'),
    },
    {
      id: 'sign',
      title: 'Rellenar y Firmar',
      description: 'Dibuja tu firma a mano alzada o escribe tu nombre para estamparlo en el documento.',
      icon: PenTool,
      color: 'from-rose-500 to-red-600',
      action: () => onNavigate('tools', 'sign'),
    },
    {
      id: 'protect',
      title: 'Proteger con Contraseña',
      description: 'Cifra tu PDF con algoritmo estándar AES-256 y restringe permisos de impresión.',
      icon: Lock,
      color: 'from-cyan-500 to-blue-600',
      action: () => onNavigate('tools', 'protect'),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto w-full select-none">
      {/* Hero Header */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold mb-4 backdrop-blur-sm">
          <Zap className="w-3.5 h-3.5 text-indigo-400" />
          <span>Motor nativo ultra rápido • 100% privado y offline</span>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-3">
          Edita cualquier PDF como en{' '}
          <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
            Adobe Pro
          </span>
        </h1>

        <p className="text-gray-400 text-sm md:text-base max-w-2xl leading-relaxed">
          Edita texto directamente sobre el PDF, organiza páginas con cuadrícula visual, une, divide, 
          estampa firmas y protege tus documentos con máxima velocidad.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative group cursor-pointer rounded-2xl border-2 border-dashed p-10 flex flex-col items-center justify-center text-center transition-all duration-300 mb-12 ${
          isDragging
            ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01] shadow-2xl shadow-indigo-500/20'
            : 'border-magic-border hover:border-indigo-500/50 bg-magic-card/60 hover:bg-magic-card shadow-lg hover:shadow-indigo-500/5'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept="application/pdf"
          multiple
          className="hidden"
        />

        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center mb-4 shadow-xl shadow-indigo-500/30 group-hover:scale-110 transition-transform">
          {isUploading ? (
            <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <UploadCloud className="w-8 h-8 text-white" />
          )}
        </div>

        <h3 className="text-lg font-bold text-white mb-1">
          {isUploading ? 'Procesando PDF...' : 'Arrastra y suelta tu archivo PDF aquí'}
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          o haz clic para seleccionar documentos desde tu equipo
        </p>

        <div className="flex items-center gap-4 text-[11px] text-gray-500 font-medium">
          <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Sin límites de tamaño</span>
          <span>•</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" /> Cero envío a la nube (100% local)</span>
        </div>
      </div>

      {/* Quick Tools Grid */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
            <span>Herramientas Profesionales</span>
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">Selecciona una herramienta para comenzar</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <div
                key={tool.id}
                onClick={tool.action}
                className="group relative p-5 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border hover:border-indigo-500/40 hover:bg-gray-50 dark:hover:bg-magic-hover/80 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-tr ${tool.color} flex items-center justify-center shadow-lg shadow-black/10 group-hover:scale-105 transition-transform`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-magic-border/40 group-hover:bg-indigo-500/20 flex items-center justify-center text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors">
                  {tool.title}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {tool.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Open Documents List */}
      {documents.length > 0 && (
        <div className="p-5 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-500" />
            <span>Documentos Abiertos ({documents.length})</span>
          </h3>

          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => onSelectDoc(doc)}
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-magic-bg/70 hover:bg-gray-100 dark:hover:bg-magic-hover border border-gray-100 dark:border-magic-border/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-900 dark:text-white">{doc.name}</h4>
                    <p className="text-[11px] text-gray-400">
                      {doc.pages} páginas • {formatSize(doc.size)}
                    </p>
                  </div>
                </div>

                <button className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors">
                  Abrir Documento
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
