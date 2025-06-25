import React, { useState, useCallback, useRef, useContext, useEffect } from 'react';
import { read, utils } from 'xlsx';
import { 
    ArrowUpOnSquareIcon, 
    ArrowDownOnSquareIcon,
    ChartBarIcon,
    PhoneIcon,
    ClockIcon,
    DocumentTextIcon
} from '@heroicons/react/24/outline';
import { DataContext } from '../App';
import { db } from '../App';
import { normalizeName } from '../utils/textUtils';
import { getTeleoperadora } from '../utils/operadoraUtils';
import { excelDateToISO } from '../utils/dateUtils';
import { prepareStatsForStorage } from '../utils/storageUtils';
import { 
    isLlamadaExitosa,
    validateLlamada,
    validateLlamadas,
    createInitialStats,
    parseStoredStats,
    ESTADOS
} from '../utils/statsUtils';
import ErrorBoundary from './ErrorBoundary';
import StatsDisplay from './StatsDisplay';
import DetailedStatsView from './DetailedStatsView';

// Constantes para el manejo del archivo
const CHUNK_SIZE = 1000;  // Procesar 1000 filas a la vez
const DEBOUNCE_DELAY = 300; // 300ms de espera entre eventos de cambio de archivo

const LoadingOverlay = ({ progress }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center w-80 max-w-[90vw]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 dark:border-blue-400 mb-4"></div>
            <p className="text-lg mb-4 text-gray-900 dark:text-white">Procesando archivo...</p>
            {progress > 0 && (
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div 
                        className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full transition-all duration-300" 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            )}
        </div>
    </div>
);

function CallDataAnalyzer() {
    const { callData, assignments, updateCallData } = useContext(DataContext);
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(createInitialStats());
    const [showDetailedStats, setShowDetailedStats] = useState(false);
    const [detailedStatsData, setDetailedStatsData] = useState(null);
    const fileInputRef = useRef(null);
    const debounceTimerRef = useRef(null);
    const uploadTimeout = useRef(null);
    const processingTimeout = useRef(null);
    
    // Referencia al estado inicial para reseteo
    const initialStatsRef = useRef(createInitialStats());

    // Limpiar timeouts al desmontar
    useEffect(() => {
        return () => {
            if (uploadTimeout.current) clearTimeout(uploadTimeout.current);
            if (processingTimeout.current) clearTimeout(processingTimeout.current);
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, []);

    // Cargar datos guardados al montar el componente
    useEffect(() => {
        if (!callData) return;
        try {
            const parsedStats = parseStoredStats(callData);
            setStats(parsedStats);
        } catch (error) {
            console.error('Error loading saved data:', error);
            setStats(initialStatsRef.current);
        }
    }, [callData]);

    // Función para procesar el archivo
    const processFile = useCallback(async () => {
        if (!file) {
            setError('Por favor selecciona un archivo');
            return;
        }

        try {
            setLoading(true);
            setProgress(0);
            setError(null);
            
            // Resetear el estado
            setStats(initialStatsRef.current);

            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    if (!e.target?.result) {
                        throw new Error('Error al leer el archivo');
                    }

                    const data = new Uint8Array(e.target.result);
                    const workbook = read(data, { type: 'array' });
                    
                    if (!workbook.SheetNames.length) {
                        throw new Error('El archivo Excel no contiene hojas');
                    }

                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    if (!firstSheet) {
                        throw new Error('No se pudo leer la hoja de Excel');
                    }

                    const rows = utils.sheet_to_json(firstSheet, { header: 1 });
                    if (rows.length <= 1) {
                        throw new Error('El archivo no contiene datos');
                    }

                    const dataRows = rows.slice(1); // Ignorar encabezados
                    const totalRows = dataRows.length;

                    let currentStats = createInitialStats();
                    
                    // Procesar en chunks
                    const processChunk = async (startIndex) => {
                        const endIndex = Math.min(startIndex + CHUNK_SIZE, totalRows);
                        const chunk = dataRows.slice(startIndex, endIndex);
                        
                        chunk.forEach((row) => {
                            if (!Array.isArray(row) || row.length < 10) return;
                            
                            try {
                                // Mapear columnas según el formato del Excel
                                const [
                                    id,             // A: Id
                                    fecha,          // B: Fecha
                                    beneficiario,   // C: Beneficiario
                                    comuna,         // D: Comuna
                                    evento,         // E: Evento (Entrante/Saliente)
                                    telefono,       // F: Fono
                                    horaIni,       // G: Ini
                                    horaFin,       // H: Fin
                                    duracion,       // I: Seg
                                    resultado,      // J: Resultado
                                    observacion,    // K: Observación
                                    apiId          // L: Api Id
                                ] = row;

                                if (!beneficiario || !fecha) return;

                                const normalizedNombre = normalizeName(beneficiario);
                                const fechaObj = new Date(fecha); // La fecha ya viene en formato YYYY-MM-DD
                                const teleoperadora = getTeleoperadora(telefono, normalizedNombre, assignments);
                                const exitoso = resultado?.toString().toLowerCase().includes('exitoso');
                                const duracionMinutos = Math.round(parseInt(duracion || 0) / 60); // Convertir segundos a minutos

                                // Validar y preparar la llamada
                                const llamada = {
                                    fecha: fechaObj,
                                    hora: horaIni,
                                    duracion: duracionMinutos,
                                    tipo: evento?.toString().toLowerCase() || '',
                                    telefono: telefono?.toString() || '',
                                    teleoperadora,
                                    comentarios: observacion?.toString() || '',
                                    resultado: resultado?.toString() || '',
                                    comuna: comuna?.toString() || '',
                                    exitoso
                                };

                                // Actualizar estadísticas
                                currentStats.totalLlamadas++;
                                currentStats.entrantes += evento?.toString().toLowerCase().includes('entrante') ? 1 : 0;
                                currentStats.salientes += evento?.toString().toLowerCase().includes('saliente') ? 1 : 0;
                                currentStats.duracionTotal += duracionMinutos;
                                currentStats.duracionPromedio = currentStats.duracionTotal / currentStats.totalLlamadas;

                                // Solo procesar beneficiarios válidos (no números de teléfono)
                                if (normalizedNombre && isNaN(normalizedNombre)) {
                                    currentStats.beneficiarios.add(normalizedNombre);
                                    
                                    if (!currentStats.llamadasPorBeneficiario[normalizedNombre]) {
                                        currentStats.llamadasPorBeneficiario[normalizedNombre] = [];
                                    }
                                    currentStats.llamadasPorBeneficiario[normalizedNombre].push(llamada);
                                    
                                    // Actualizar última llamada
                                    if (!currentStats.ultimasLlamadas[normalizedNombre]?.fecha || 
                                        fechaObj > currentStats.ultimasLlamadas[normalizedNombre].fecha) {
                                        currentStats.ultimasLlamadas[normalizedNombre] = llamada;
                                    }

                                    // Actualizar comuna
                                    if (comuna) {
                                        if (!currentStats.comunas.has(comuna)) {
                                            currentStats.comunas.set(comuna, new Set());
                                        }
                                        currentStats.comunas.get(comuna).add(normalizedNombre);
                                    }

                                    // Actualizar estado del beneficiario
                                    const ultimaLlamada = currentStats.ultimasLlamadas[normalizedNombre];
                                    const diasDesdeUltimaLlamada = Math.floor((new Date() - ultimaLlamada.fecha) / (1000 * 60 * 60 * 24));
                                    
                                    if (exitoso && diasDesdeUltimaLlamada <= 15) {
                                        currentStats.beneficiariosAlDia.add(normalizedNombre);
                                    } else if (!exitoso && diasDesdeUltimaLlamada > 15) {
                                        currentStats.beneficiariosPendientes.add(normalizedNombre);
                                    } else if (!exitoso && diasDesdeUltimaLlamada > 30) {
                                        currentStats.beneficiariosUrgentes.add(normalizedNombre);
                                    }

                                    // Actualizar métricas de teleoperadora
                                    if (!currentStats.teleoperadoras[teleoperadora]) {
                                        currentStats.teleoperadoras[teleoperadora] = {
                                            total: 0,
                                            exitosas: 0,
                                            beneficiarios: new Set()
                                        };
                                    }
                                    currentStats.teleoperadoras[teleoperadora].total++;
                                    currentStats.teleoperadoras[teleoperadora].beneficiarios.add(normalizedNombre);
                                    if (exitoso) {
                                        currentStats.teleoperadoras[teleoperadora].exitosas++;
                                    }
                                }
                            } catch (err) {
                                console.error('Error processing row:', err);
                            }
                        });
                        
                        const progress = Math.round((endIndex / totalRows) * 100);
                        setProgress(progress);
                        setStats(currentStats);
                        
                        if (endIndex < totalRows) {
                            processingTimeout.current = setTimeout(() => processChunk(endIndex), 0);
                        } else {
                            setLoading(false);
                            setProgress(100);
                        }
                    };
                    
                    await processChunk(0);
                } catch (error) {
                    console.error('Error processing Excel:', error);
                    setError(`Error al procesar el archivo: ${error.message}`);
                    setStats(initialStatsRef.current);
                    setLoading(false);
                }
            };
            
            reader.onerror = () => {
                setError('Error al leer el archivo');
                setStats(initialStatsRef.current);
                setLoading(false);
            };
            
            reader.readAsArrayBuffer(file);
        } catch (error) {
            console.error('Error processing file:', error);
            setError(`Error al procesar el archivo: ${error.message}`);
            setStats(initialStatsRef.current);
            setLoading(false);
        }
    }, [file, assignments]);

    const handleFileChange = useCallback((event) => {
        const selectedFile = event.target.files?.[0];
        if (!selectedFile) {
            setError('Por favor selecciona un archivo');
            return;
        }

        if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
            setError('Por favor selecciona un archivo Excel válido (.xlsx o .xls)');
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }

        setFile(selectedFile);
        setError(null);
    }, []);

    const resetState = useCallback(() => {
        setFile(null);
        setStats(initialStatsRef.current);
        setProgress(0);
        setError(null);
        setLoading(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    // Efecto para sincronizar con el contexto global
    useEffect(() => {
        if (!stats || stats.totalLlamadas === 0) return;

        try {            const serializedStats = prepareStatsForStorage(stats, assignments);
            if (serializedStats) {
                console.log('Actualizando contexto global con:', serializedStats);
                localStorage.setItem('currentStats', JSON.stringify(serializedStats));
                updateCallData(serializedStats);
            }
        } catch (error) {
            console.error('Error serializing stats:', error);
        }
    }, [stats, updateCallData, assignments]);

    return (
        <ErrorBoundary>
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between mb-6 space-y-4 lg:space-y-0">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <DocumentTextIcon className="h-8 w-8 mr-2 text-blue-500 dark:text-blue-400" />
                        Registro de Llamadas
                    </h2>
                    
                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className={`inline-flex items-center px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors duration-200
                                ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600 dark:hover:bg-blue-700'} 
                                bg-blue-500 dark:bg-blue-600 text-white focus:ring-blue-500`}
                            disabled={loading}
                        >
                            <ArrowUpOnSquareIcon className="h-5 w-5 mr-2" />
                            {file ? file.name : 'Seleccionar Archivo'}
                        </button>
                        
                        <button
                            onClick={processFile}
                            disabled={!file || loading}
                            className={`inline-flex items-center px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors duration-200
                                ${file && !loading 
                                    ? 'bg-green-500 dark:bg-green-600 text-white hover:bg-green-600 dark:hover:bg-green-700 focus:ring-green-500' 
                                    : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'}`}
                            title={!file ? 'Seleccione un archivo primero' : loading ? 'Procesando...' : 'Procesar archivo'}
                        >
                            <ArrowDownOnSquareIcon className="h-5 w-5 mr-2" />
                            {loading ? 'Procesando...' : 'Procesar Archivo'}
                        </button>
                        
                        {stats.totalLlamadas > 0 && (
                            <button
                                onClick={resetState}
                                className="inline-flex items-center px-4 py-2 bg-red-500 dark:bg-red-600 text-white rounded-lg hover:bg-red-600 dark:hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors duration-200"
                                title="Limpiar datos y cargar nuevo archivo"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                Limpiar
                            </button>
                        )}
                    </div>
                    
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".xlsx,.xls"
                        className="hidden"
                    />
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-100 dark:bg-red-900 border-l-4 border-red-500 text-red-700 dark:text-red-200">
                        <div className="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <p className="font-medium">{error}</p>
                        </div>
                        <button 
                            onClick={resetState}
                            className="mt-2 text-sm text-red-600 dark:text-red-300 hover:text-red-800 dark:hover:text-red-100"
                        >
                            Intentar de nuevo
                        </button>
                    </div>
                )}

                {loading && <LoadingOverlay progress={progress} />}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <StatsDisplay
                        icon={<PhoneIcon className="h-8 w-8 text-blue-500" />}
                        title="Total de Llamadas"
                        value={stats.totalLlamadas}
                        subtitle={`${stats.entrantes} entrantes, ${stats.salientes} salientes`}
                    />
                    
                    <StatsDisplay
                        icon={<ChartBarIcon className="h-8 w-8 text-green-500" />}
                        title="Beneficiarios Únicos"
                        value={stats.beneficiarios.size}
                        subtitle="Total de personas contactadas"
                    />
                    
                    <StatsDisplay
                        icon={<ClockIcon className="h-8 w-8 text-purple-500" />}
                        title="Duración Promedio"
                        value={`${Math.round(stats.duracionPromedio)} min`}
                        subtitle={`Total: ${Math.round(stats.duracionTotal)} min`}
                    />
                </div>                {stats.totalLlamadas > 0 && (
                    <DetailedStatsView 
                        stats={{
                            ...stats,
                            comunas: stats.comunas || new Map(),
                            horasPico: new Map(), // Si no estamos usando horasPico, inicializamos vacío
                            totalLlamadas: stats.totalLlamadas || 0,
                        }}
                        operatorStats={Object.entries(stats.llamadasPorBeneficiario || {}).reduce((acc, [beneficiario, datos]) => {
                            const operadora = datos.operadora || 'No asignada';
                            if (!acc[operadora]) {
                                acc[operadora] = {
                                    totalLlamadas: 0,
                                    beneficiarios: new Set(),
                                    diasTrabajados: 30, // Por defecto asumimos un mes
                                    duracionTotal: 0
                                };
                            }
                            acc[operadora].totalLlamadas += datos.total || 0;
                            acc[operadora].beneficiarios.add(beneficiario);
                            acc[operadora].duracionTotal += (datos.total || 0) * stats.duracionPromedio;
                            return acc;
                        }, {})}
                    />
                )}
            </div>
        </ErrorBoundary>
    );
}

export default CallDataAnalyzer;
