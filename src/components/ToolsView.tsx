import React, { useState, useRef, useEffect } from 'react';
import { 
  FilePlus2, 
  Scissors, 
  PenTool, 
  Lock, 
  EyeOff, 
  Upload, 
  Check, 
  RefreshCw, 
  Trash2,
  Download,
  Shield,
  FileCheck2,
  Sparkles
} from 'lucide-react';
import { PdfDocument, ToolType } from '../types';
import { 
  combinePdfs, 
  splitPdf, 
  signDocument, 
  protectDocument, 
  redactArea, 
  getDownloadUrl,
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

  // Protect state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Redact state
  const [redactPage, setRedactPage] = useState(1);

  // Initialize canvas for signature
  useEffect(() => {
    if (activeTab === 'sign' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [activeTab]);

  // Drawing handlers
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

  const handleApplySignature = async () => {
    if (!activeDoc || !canvasRef.current || !hasSignature) return;
    try {
      setIsLoading(true);
      const dataUrl = canvasRef.current.toDataURL('image/png');
      // Stamp at bottom right of chosen page
      await signDocument(activeDoc.filename, sigPage, dataUrl, [400, 680], 160, 65);
      alert('¡Firma estampada con éxito en el PDF!');
      clearSignature();
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al firmar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProtect = async () => {
    if (!activeDoc || !password) return;
    if (password !== confirmPassword) {
      alert('Las contraseñas no coinciden');
      return;
    }
    try {
      setIsLoading(true);
      await protectDocument(activeDoc.filename, password);
      alert('¡PDF protegido con contraseña exitosamente!');
      setPassword('');
      setConfirmPassword('');
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al proteger: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const tabs = [
    { id: 'merge' as ToolType, label: 'Unir PDFs', icon: FilePlus2 },
    { id: 'split' as ToolType, label: 'Dividir PDF', icon: Scissors },
    { id: 'sign' as ToolType, label: 'Firma Digital', icon: PenTool },
    { id: 'protect' as ToolType, label: 'Proteger con Clave', icon: Lock },
  ];

  return (
    <div className="flex-1 flex overflow-hidden bg-magic-bg select-none">
      {/* Sidebar Navigation */}
      <div className="w-64 border-r border-magic-border bg-magic-card/60 p-4 flex flex-col gap-1.5 shrink-0">
        <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Herramientas Pro
        </div>

        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-gray-400 hover:text-white hover:bg-magic-hover'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Tool Content Area */}
      <div className="flex-1 overflow-y-auto p-10 max-w-4xl mx-auto">
        {/* MERGE TAB */}
        {activeTab === 'merge' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                <FilePlus2 className="w-6 h-6 text-indigo-400" />
                <span>Unir Múltiples PDFs en Uno Solo</span>
              </h2>
              <p className="text-xs text-gray-400">
                Selecciona los documentos que deseas combinar en el orden deseado.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-magic-card border border-magic-border space-y-4">
              <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wider">
                Documentos a Unir ({selectedMergeFiles.length})
              </h3>

              {documents.length < 2 ? (
                <div className="p-6 rounded-xl bg-magic-bg border border-dashed border-magic-border text-center text-xs text-gray-400">
                  Sube al menos dos archivos PDF desde el botón de la barra superior para poder unirlos.
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc, idx) => {
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
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-indigo-500/10 border-indigo-500/50 text-white'
                            : 'bg-magic-bg/70 border-magic-border/50 text-gray-400'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-md bg-magic-border flex items-center justify-center text-xs font-mono font-semibold">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-medium">{doc.name}</span>
                          <span className="text-[10px] text-gray-500">({doc.pages} páginas)</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="rounded text-indigo-600 w-4 h-4"
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={handleMerge}
                disabled={isLoading || selectedMergeFiles.length < 2}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Uniendo documentos...</span>
                  </>
                ) : (
                  <>
                    <FilePlus2 className="w-4 h-4" />
                    <span>Unir Documentos Seleccionados</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* SPLIT TAB */}
        {activeTab === 'split' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                <Scissors className="w-6 h-6 text-indigo-400" />
                <span>Dividir Documento PDF</span>
              </h2>
              <p className="text-xs text-gray-400">
                Divide {activeDoc ? `"${activeDoc.name}" (${activeDoc.pages} páginas)` : 'un documento'} en partes independientes.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-magic-card border border-magic-border text-center text-xs text-gray-400">
                Selecciona un documento abierto para dividirlo.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-magic-card border border-magic-border space-y-6">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-2">
                    Dividir cada:
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      max={activeDoc.pages}
                      value={splitEvery}
                      onChange={(e) => setSplitEvery(Math.max(1, Number(e.target.value)))}
                      className="w-24 bg-magic-bg border border-magic-border rounded-xl px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500"
                    />
                    <span className="text-xs text-gray-400">
                      páginas (Generará aprox. {Math.ceil(activeDoc.pages / splitEvery)} archivos PDF)
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleSplit}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
                >
                  {isLoading ? 'Dividiendo...' : 'Dividir PDF Ahora'}
                </button>

                {splitResults.length > 0 && (
                  <div className="pt-4 border-t border-magic-border space-y-2">
                    <span className="text-xs font-semibold text-emerald-400">Archivos resultantes:</span>
                    <div className="grid grid-cols-2 gap-2">
                      {splitResults.map((part, i) => (
                        <a
                          key={i}
                          href={getDownloadUrl(part)}
                          download
                          className="flex items-center justify-between p-2.5 rounded-lg bg-magic-bg border border-magic-border text-xs text-gray-300 hover:text-white hover:border-indigo-500 transition-colors"
                        >
                          <span className="truncate">{part.split(/[\\/]/).pop()}</span>
                          <Download className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SIGNATURE TAB */}
        {activeTab === 'sign' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                <PenTool className="w-6 h-6 text-indigo-400" />
                <span>Rellenar y Firmar Documento</span>
              </h2>
              <p className="text-xs text-gray-400">
                Dibuja tu firma y estámpala en cualquier página de {activeDoc ? `"${activeDoc.name}"` : 'tu documento'}.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-magic-card border border-magic-border text-center text-xs text-gray-400">
                Selecciona un documento abierto para estampar tu firma.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-magic-card border border-magic-border space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-300">
                      Dibuja tu firma en el recuadro:
                    </label>
                    <button
                      onClick={clearSignature}
                      className="text-xs text-rose-400 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Limpiar</span>
                    </button>
                  </div>

                  <div className="border border-magic-border rounded-xl bg-white overflow-hidden shadow-inner flex items-center justify-center">
                    <canvas
                      ref={canvasRef}
                      width={500}
                      height={180}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      className="cursor-crosshair w-full h-[180px]"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Estampar en Página:</span>
                    <select
                      value={sigPage}
                      onChange={(e) => setSigPage(Number(e.target.value))}
                      className="bg-magic-bg border border-magic-border rounded-lg text-xs text-white px-3 py-1.5 outline-none"
                    >
                      {Array.from({ length: activeDoc.pages }, (_, i) => (
                        <option key={i + 1} value={i + 1}>Página {i + 1}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={handleApplySignature}
                    disabled={isLoading || !hasSignature}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
                  >
                    {isLoading ? 'Estampando...' : 'Estampar Firma en PDF'}
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
              <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                <Lock className="w-6 h-6 text-indigo-400" />
                <span>Proteger PDF con Contraseña</span>
              </h2>
              <p className="text-xs text-gray-400">
                Añade cifrado AES-256 para exigir clave antes de abrir el documento.
              </p>
            </div>

            {!activeDoc ? (
              <div className="p-8 rounded-2xl bg-magic-card border border-magic-border text-center text-xs text-gray-400">
                Selecciona un documento para protegerlo.
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-magic-card border border-magic-border space-y-4 max-w-md">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">
                    Contraseña:
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Introduce contraseña..."
                    className="w-full bg-magic-bg border border-magic-border rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">
                    Confirmar Contraseña:
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña..."
                    className="w-full bg-magic-bg border border-magic-border rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  onClick={handleProtect}
                  disabled={isLoading || !password}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
                >
                  {isLoading ? 'Cifrando...' : 'Cifrar Documento con AES-256'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
