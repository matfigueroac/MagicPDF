import React, { useState, useRef, useEffect } from 'react';
import { 
  FilePlus2, 
  Scissors, 
  PenTool, 
  Lock, 
  EyeOff, 
  Check, 
  Trash2,
  Minimize2,
  Stamp,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { PdfDocument, ToolType } from '../types';
import { 
  combinePdfs, 
  splitPdf, 
  signDocument, 
  protectDocument, 
  redactArea, 
  compressDocument,
  watermarkDocument,
  getPageImageUrl 
} from '../api/client';

interface ToolsViewProps {
  initialTool?: ToolType;
  activeDoc: PdfDocument | null;
  documents: PdfDocument[];
  onDocumentAdded: (doc: PdfDocument) => void;
  onDocumentUpdated: () => void;
}

export const ToolsView: React.FC<ToolsViewProps> = ({
  initialTool = 'merge',
  activeDoc,
  documents,
  onDocumentAdded,
  onDocumentUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<ToolType>(initialTool);
  useEffect(() => { setActiveTab(initialTool); }, [initialTool]);
  const [isLoading, setIsLoading] = useState(false);

  // Merge state
  const [selectedMergeFiles, setSelectedMergeFiles] = useState<string[]>(() => 
    documents.map(d => d.filename)
  );

  // Split state
  const [splitEvery, setSplitEvery] = useState(1);
  const [splitResults, setSplitResults] = useState<string[]>([]);

  // Signature state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [sigPage, setSigPage] = useState(1);
  const [hasSignature, setHasSignature] = useState(false);

  // Password state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Redact state
  const [redactPage, setRedactPage] = useState(1);

  // Compress state
  const [compressResult, setCompressResult] = useState<{ beforeSize: number; afterSize: number; reducedPercent: number } | null>(null);

  // Watermark state
  const [watermarkText, setWatermarkText] = useState('CONFIDENCIAL');
  const [watermarkColor, setWatermarkColor] = useState('#EF4444');
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.35);
  const [watermarkAngle, setWatermarkAngle] = useState(45);

  const tabs = [
    { id: 'compress' as ToolType, label: 'Comprimir PDF', icon: Minimize2, color: 'text-emerald-500' },
    { id: 'merge' as ToolType, label: 'Unir PDFs', icon: FilePlus2, color: 'text-indigo-500' },
    { id: 'split' as ToolType, label: 'Dividir PDF', icon: Scissors, color: 'text-pink-500' },
    { id: 'sign' as ToolType, label: 'Firmar Documento', icon: PenTool, color: 'text-amber-500' },
    { id: 'watermark' as ToolType, label: 'Marca de Agua', icon: Stamp, color: 'text-purple-500' },
    { id: 'protect' as ToolType, label: 'Proteger Contraseña', icon: Lock, color: 'text-blue-500' },
    { id: 'redact' as ToolType, label: 'Censurar Área', icon: EyeOff, color: 'text-rose-500' },
  ];

  // Signature Canvas Drawing
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    setHasSignature(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasSignature(false);
    }
  };

  // Actions
  const handleCompress = async () => {
    if (!activeDoc) return;
    try {
      setIsLoading(true);
      const res = await compressDocument(activeDoc.filename);
      setCompressResult(res);
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al comprimir: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWatermark = async () => {
    if (!activeDoc || !watermarkText.trim()) return;
    try {
      setIsLoading(true);
      await watermarkDocument(activeDoc.filename, watermarkText, {
        color: watermarkColor,
        opacity: watermarkOpacity,
        rotation: watermarkAngle
      });
      alert('¡Marca de agua aplicada exitosamente a todas las páginas!');
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al aplicar marca de agua: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMerge = async () => {
    if (selectedMergeFiles.length < 2) {
      alert('Selecciona al menos 2 documentos para unir');
      return;
    }
    try {
      setIsLoading(true);
      const newDoc = await combinePdfs(selectedMergeFiles, 'documento_unido.pdf');
      alert('¡Documentos unidos con éxito!');
      onDocumentAdded(newDoc);
    } catch (err: any) {
      alert(`Error al unir: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSplit = async () => {
    if (!activeDoc) return;
    try {
      setIsLoading(true);
      const parts = await splitPdf(activeDoc.filename, splitEvery);
      setSplitResults(parts);
      alert(`¡Documento dividido en ${parts.length} partes!`);
    } catch (err: any) {
      alert(`Error al dividir: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSign = async () => {
    if (!activeDoc || !canvasRef.current || !hasSignature) {
      alert('Por favor dibuja tu firma primero.');
      return;
    }
    try {
      setIsLoading(true);
      const sigData = canvasRef.current.toDataURL('image/png');
      await signDocument(activeDoc.filename, sigPage, sigData, [100, 650], 180, 80);
      alert('¡Firma estampada exitosamente en la página!');
      clearSignature();
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al firmar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProtect = async () => {
    if (!activeDoc) return;
    if (!password) {
      alert('Introduce una contraseña');
      return;
    }
    if (password !== confirmPassword) {
      alert('Las contraseñas no coinciden');
      return;
    }
    try {
      setIsLoading(true);
      await protectDocument(activeDoc.filename, password);
      alert('¡Documento protegido exitosamente con cifrado AES-256!');
      setPassword('');
      setConfirmPassword('');
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al proteger: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-gray-50 dark:bg-magic-bg select-none transition-colors">
      {/* Sidebar Navigation */}
      <div className="w-60 border-r border-gray-200 dark:border-magic-border bg-white dark:bg-magic-card p-3 flex flex-col gap-1 shrink-0 transition-colors">
        <div className="px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Herramientas Pro
        </div>

        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : tab.color}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Tool Content Area */}
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto">
        {/* COMPRESS TAB */}
        {activeTab === 'compress' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                <Minimize2 className="w-5 h-5 text-emerald-500" />
                <span>Comprimir y Optimizar PDF</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Acrobat Reduce Size: Comprime imágenes a 150 DPI y elimina objetos duplicados para reducir drásticamente el peso del archivo.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border text-center text-xs text-gray-400">
                Abre un documento para comprimirlo.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border space-y-4 max-w-md shadow-sm">
                <div className="flex justify-between items-center text-xs p-3 bg-gray-50 dark:bg-magic-bg rounded-xl border border-gray-100 dark:border-magic-border">
                  <span className="text-gray-500 dark:text-gray-400">Tamaño actual:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {(activeDoc.size / (1024 * 1024)).toFixed(2)} MB ({activeDoc.size.toLocaleString()} bytes)
                  </span>
                </div>

                {compressResult && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                      <Check className="w-4 h-4" />
                      <span>¡Compresión completada!</span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300 flex items-center justify-between">
                      <span>Nuevo tamaño:</span>
                      <span className="font-bold text-emerald-500">
                        {(compressResult.afterSize / (1024 * 1024)).toFixed(2)} MB (-{compressResult.reducedPercent}%)
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleCompress}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40"
                >
                  <Minimize2 className="w-4 h-4" />
                  <span>{isLoading ? 'Optimizando...' : 'Comprimir PDF Ahora'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* WATERMARK TAB */}
        {activeTab === 'watermark' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                <Stamp className="w-5 h-5 text-purple-500" />
                <span>Marca de Agua en Todas las Páginas</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Estampa un sello distintivo semi-transparente como "CONFIDENCIAL", "BORRADOR" o el nombre de tu empresa.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border text-center text-xs text-gray-400">
                Abre un documento para añadirle una marca de agua.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border space-y-4 max-w-md shadow-sm">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                    Texto de la Marca:
                  </label>
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    placeholder="Ej: CONFIDENCIAL"
                    className="w-full bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl px-3.5 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-indigo-500 font-semibold uppercase"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                      Color:
                    </label>
                    <input
                      type="color"
                      value={watermarkColor}
                      onChange={(e) => setWatermarkColor(e.target.value)}
                      className="w-full h-9 rounded-xl bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border cursor-pointer p-1"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                      Opacidad: {Math.round(watermarkOpacity * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(parseFloat(e.target.value))}
                      className="w-full mt-2 accent-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                    Ángulo de Inclinación: {watermarkAngle}°
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="90"
                    step="5"
                    value={watermarkAngle}
                    onChange={(e) => setWatermarkAngle(parseInt(e.target.value, 10))}
                    className="w-full mt-2 accent-indigo-500"
                  />
                </div>

                <button
                  onClick={handleWatermark}
                  disabled={isLoading || !watermarkText.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-600/25 transition-all disabled:opacity-40"
                >
                  <Stamp className="w-4 h-4" />
                  <span>{isLoading ? 'Aplicando...' : 'Aplicar Marca a Todo el PDF'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* MERGE TAB */}
        {activeTab === 'merge' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                <FilePlus2 className="w-5 h-5 text-indigo-500" />
                <span>Unir Múltiples PDFs en Uno Solo</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Selecciona los documentos que deseas combinar en un solo archivo final.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border space-y-4 shadow-sm">
              <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wider">
                Documentos a Unir ({selectedMergeFiles.length})
              </h3>

              {documents.length < 2 ? (
                <div className="p-6 rounded-xl bg-gray-50 dark:bg-magic-bg border border-dashed border-gray-200 dark:border-magic-border text-center text-xs text-gray-400">
                  Abre al menos dos archivos PDF para poder unirlos en un solo documento.
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => {
                    const isSelected = selectedMergeFiles.includes(doc.filename);
                    return (
                      <div
                        key={doc.id}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedMergeFiles(s => s.filter(f => f !== doc.filename));
                          } else {
                            setSelectedMergeFiles(s => [...s, doc.filename]);
                          }
                        }}
                        className={`flex items-center justify-between p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-indigo-500/10 border-indigo-500/40 text-gray-900 dark:text-white'
                            : 'bg-gray-50 dark:bg-magic-bg border-gray-200 dark:border-magic-border text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                            isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-magic-border'
                          }`}>
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                          <span className="font-medium">{doc.name}</span>
                        </div>
                        <span className="text-[11px] text-gray-400">({doc.pages} páginas)</span>
                      </div>
                    );
                  })}

                  <button
                    onClick={handleMerge}
                    disabled={isLoading || selectedMergeFiles.length < 2}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40 mt-4"
                  >
                    <span>{isLoading ? 'Uniendo...' : `Unir ${selectedMergeFiles.length} Documentos`}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SPLIT TAB */}
        {activeTab === 'split' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                <Scissors className="w-5 h-5 text-pink-500" />
                <span>Dividir PDF en Partes</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Extrae páginas individuales o divide el documento cada N páginas.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border text-center text-xs text-gray-400">
                Selecciona un documento para dividirlo.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border space-y-4 max-w-md shadow-sm">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                    Dividir cada cuántas páginas:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={activeDoc.pages}
                      value={splitEvery}
                      onChange={(e) => setSplitEvery(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-20 bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white text-center font-bold"
                    />
                    <span className="text-xs text-gray-500">
                      página(s) (resultarán ~{Math.ceil(activeDoc.pages / splitEvery)} archivos)
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleSplit}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold shadow-lg shadow-pink-600/30 transition-all disabled:opacity-40"
                >
                  <Scissors className="w-4 h-4" />
                  <span>{isLoading ? 'Dividiendo...' : 'Dividir Documento Ahora'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* SIGN TAB */}
        {activeTab === 'sign' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                <PenTool className="w-5 h-5 text-amber-500" />
                <span>Firmar Documento</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Dibuja tu firma a mano alzada y estámpala en cualquier página del PDF.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border text-center text-xs text-gray-400">
                Abre un documento para estampar tu firma.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border space-y-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      Dibuja tu firma aquí:
                    </span>
                    <button
                      onClick={clearSignature}
                      className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Limpiar</span>
                    </button>
                  </div>

                  <div className="border border-gray-200 dark:border-magic-border rounded-xl bg-white overflow-hidden shadow-inner">
                    <canvas
                      ref={canvasRef}
                      width={380}
                      height={180}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      className="w-full h-[180px] cursor-crosshair"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-xs text-gray-500">Estampar en página:</span>
                    <select
                      value={sigPage}
                      onChange={(e) => setSigPage(parseInt(e.target.value, 10))}
                      className="bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-lg px-2.5 py-1 text-xs text-gray-800 dark:text-gray-200"
                    >
                      {Array.from({ length: activeDoc.pages }, (_, i) => i + 1).map(p => (
                        <option key={p} value={p}>Página {p}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={handleSign}
                    disabled={isLoading || !hasSignature}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg shadow-amber-600/30 transition-all disabled:opacity-40"
                  >
                    <span>{isLoading ? 'Estampando...' : 'Estampar Firma en el PDF'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PROTECT TAB */}
        {activeTab === 'protect' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                <Lock className="w-5 h-5 text-blue-500" />
                <span>Proteger PDF con Contraseña</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Añade cifrado AES-256 para exigir clave antes de abrir el documento.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border text-center text-xs text-gray-400">
                Selecciona un documento para protegerlo.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border space-y-4 max-w-md shadow-sm">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                    Contraseña:
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Introduce contraseña..."
                    className="w-full bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl px-3.5 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                    Confirmar Contraseña:
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña..."
                    className="w-full bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl px-3.5 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  onClick={handleProtect}
                  disabled={isLoading || !password}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition-all disabled:opacity-40"
                >
                  <Lock className="w-4 h-4" />
                  <span>{isLoading ? 'Cifrando...' : 'Cifrar Documento con AES-256'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
