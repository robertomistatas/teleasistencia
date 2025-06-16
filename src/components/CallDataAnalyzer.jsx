import React, { useState, useCallback, useRef, useEffect, useMemo, useContext } from 'react';
import { read, utils } from 'xlsx';
import { ArrowUpOnSquareIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import StatsDisplay from './StatsDisplay';
import DetailedStatsView from './DetailedStatsView';
import ErrorBoundary from './ErrorBoundary';
import { DataContext } from '../App';

// Constantes para el manejo del archivo
const CHUNK_SIZE = 1000;  // Procesar 1000 filas a la vez
const DEBOUNCE_DELAY = 300; // 300ms de espera entre eventos de cambio de archivo

const LoadingOverlay = ({ progress }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-lg shadow-xl flex flex-col items-center w-80">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
            <p className="text-lg mb-4">Procesando archivo...</p>
            {progress > 0 && (
                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                    <div 
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            )}
        </div>
    </div>
);

function CallDataAnalyzer() {
    const { assignments } = useContext(DataContext);
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [progress, setProgress] = useState(0);
    const [stats, setStats] = useState({
        totalLlamadas: 0,
        entrantes: 0,
        salientes: 0,
        duracionTotal: 0,
        duracionPromedio: 0,
        beneficiarios: new Set(),
        comunas: new Map(),
        horasPico: new Map()
    });
    const [operatorStats, setOperatorStats] = useState({});    const uploadTimeout = useRef(null);
    const processingTimeout = useRef(null);    // Función para obtener la teleoperadora asignada a un beneficiario por su teléfono
    const getTeleoperadora = useCallback((telefono, nombre) => {
        if (!assignments?.asignaciones) return 'No identificada';

        // Buscar en las asignaciones de cada operadora
        for (const [operadoraNombre, asignaciones] of Object.entries(assignments.asignaciones)) {
            const encontrado = asignaciones.some(asignacion => {
                const nombreCoincide = nombre && 
                    asignacion.beneficiario.toLowerCase() === nombre.toLowerCase();
                const telefonoCoincide = telefono && 
                    asignacion.telefonos && 
                    asignacion.telefonos.includes(telefono);
                return nombreCoincide || telefonoCoincide;
            });
            
            if (encontrado) {
                return operadoraNombre;
            }
        }
        
        return 'No identificada';        return 'No identificada';
    }, [assignments?.asignaciones]);

    const handleFileChange = useCallback((e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        // Clear any existing timeouts
        if (uploadTimeout.current) {
            clearTimeout(uploadTimeout.current);
        }

        uploadTimeout.current = setTimeout(() => {
            // Validate file type
            const validTypes = [
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
                'application/vnd.ms-excel' // .xls
            ];
            if (!validTypes.includes(selectedFile.type)) {
                setError('Por favor seleccione un archivo Excel (.xlsx o .xls)');
                return;
            }

            // Validate file size (max 10MB)
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (selectedFile.size > maxSize) {
                setError('El archivo es demasiado grande. Máximo 10MB.');
                return;
            }

            setFile(selectedFile);
            setError(null);
        }, DEBOUNCE_DELAY);
    }, []);

    const processRowsChunk = useCallback((rows, startIdx, endIdx, colIndexes, prevStats = null) => {
        const stats = prevStats || {
            totalLlamadas: 0,
            entrantes: 0,
            salientes: 0,
            duracionTotal: 0,
            duracionPromedio: 0,
            beneficiarios: new Set(),
            comunas: new Map(),
            horasPico: new Map(),
            operadoras: new Map()
        };

        const fechasPorOperadora = new Map();

        for (let i = startIdx; i < Math.min(endIdx, rows.length); i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            try {                const evento = row[colIndexes.evento]?.toString().toLowerCase() || '';
                const beneficiario = row[colIndexes.beneficiario]?.toString() || 'No identificado';
                const comuna = row[colIndexes.comuna]?.toString() || 'Sin comuna';
                const horaInicio = row[colIndexes.ini]?.toString() || '';
                const segundos = parseInt(row[colIndexes.seg], 10) || 0;
                const fecha = row[colIndexes.fecha]?.toString() || '';
                const telefono = row[colIndexes.fono]?.toString() || '';
                
                // Identificar teleoperadora usando las asignaciones
                const teleoperadora = getTeleoperadora(telefono, beneficiario);
                
                // Actualizar estadísticas generales
                stats.totalLlamadas++;
                if (evento.includes('entrante')) {
                    stats.entrantes++;
                } else {
                    stats.salientes++;
                }

                if (beneficiario !== 'No identificado') {
                    stats.beneficiarios.add(beneficiario);
                }

                stats.duracionTotal += segundos;

                stats.comunas.set(comuna, (stats.comunas.get(comuna) || 0) + 1);

                if (horaInicio) {
                    try {
                        const hora = horaInicio.split(':')[0];
                        if (hora && !isNaN(parseInt(hora))) {
                            stats.horasPico.set(hora, (stats.horasPico.get(hora) || 0) + 1);
                        }
                    } catch (err) {
                        console.warn('Error procesando hora:', horaInicio, err);
                    }
                }

                // Actualizar estadísticas por operadora
                if (!stats.operadoras.has(teleoperadora)) {
                    stats.operadoras.set(teleoperadora, {
                        totalLlamadas: 0,
                        entrantes: 0,
                        salientes: 0,
                        duracionTotal: 0,
                        fechas: new Set()
                    });
                }

                const operadoraStats = stats.operadoras.get(teleoperadora);
                operadoraStats.totalLlamadas++;
                operadoraStats.duracionTotal += segundos;
                if (evento.includes('entrante')) {
                    operadoraStats.entrantes++;
                } else {
                    operadoraStats.salientes++;
                }
                if (fecha) {
                    operadoraStats.fechas.add(fecha);
                }

            } catch (err) {
                console.warn('Error procesando fila:', i + 1, err);
            }
        }

        return stats;
    }, [getTeleoperadora]);

    const processRows = useCallback((rows, colIndexes) => {
        return new Promise(async (resolve, reject) => {
            try {
                let currentStats = null;
                const totalChunks = Math.ceil((rows.length - 1) / CHUNK_SIZE);
                
                for (let chunk = 0; chunk < totalChunks; chunk++) {
                    const startIdx = chunk * CHUNK_SIZE + 1; // +1 to skip header row
                    const endIdx = startIdx + CHUNK_SIZE;
                    
                    // Process chunk
                    currentStats = processRowsChunk(rows, startIdx, endIdx, colIndexes, currentStats);
                    
                    // Update progress
                    const progress = Math.round((chunk + 1) / totalChunks * 100);
                    setProgress(progress);
                    
                    // Let UI update
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                if (currentStats) {
                    currentStats.duracionPromedio = currentStats.totalLlamadas > 0 
                        ? currentStats.duracionTotal / currentStats.totalLlamadas 
                        : 0;
                }

                resolve(currentStats);
            } catch (err) {
                reject(err);
            }
        });
    }, [processRowsChunk]);

    const handleFileUpload = useCallback(async () => {
        try {
            if (!file) {
                throw new Error('Por favor seleccione un archivo');
            }

            setLoading(true);
            setError(null);
            setProgress(0);

            console.log('Leyendo archivo:', file.name);
            const data = await file.arrayBuffer();
            const workbook = read(data);
            
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                throw new Error('El archivo Excel no contiene hojas de cálculo');
            }

            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            if (!worksheet) {
                throw new Error('No se pudo leer la hoja de cálculo');
            }

            const rows = utils.sheet_to_json(worksheet, {
                header: 1,
                blankrows: false,
                rawNumbers: false
            });

            if (rows.length < 2) {
                throw new Error('El archivo no contiene datos suficientes');
            }

            console.log('Datos leídos:', rows.length, 'filas');
            console.log('Primera fila (encabezados):', rows[0]);

            // Mapear los índices de las columnas
            const headerRow = rows[0].map(h => h?.toString().toLowerCase());
            const getColIndex = (name) => headerRow.findIndex(h => h === name.toLowerCase());
              const colIndexes = {
                id: getColIndex('id'),
                fecha: getColIndex('fecha'),
                beneficiario: getColIndex('beneficiario'),
                comuna: getColIndex('comuna'),
                evento: getColIndex('evento'),
                fono: getColIndex('fono'),
                ini: getColIndex('ini'),
                fin: getColIndex('fin'),
                seg: getColIndex('seg'),
                observacion: getColIndex('observación') || getColIndex('observacion')
            };// Validar que encontramos todas las columnas necesarias
            const requiredColumns = ['id', 'fecha', 'beneficiario', 'comuna', 'evento', 'fono', 'ini', 'fin'];
            const missingColumns = requiredColumns
                .filter(col => colIndexes[col] === -1)
                .map(col => col);

            if (missingColumns.length > 0) {
                throw new Error(`Columnas requeridas no encontradas: ${missingColumns.join(', ')}`);
            }

            // Procesar los datos en chunks
            const newStats = await processRows(rows, colIndexes);

            if (newStats) {
                // Procesar estadísticas por operadora
                const operatorStats = {};
                newStats.operadoras.forEach((stats, operadora) => {
                    operatorStats[operadora] = {
                        totalLlamadas: stats.totalLlamadas,
                        entrantes: stats.entrantes,
                        salientes: stats.salientes,
                        duracionTotal: stats.duracionTotal,
                        diasTrabajados: stats.fechas.size,
                        duracionPromedio: stats.totalLlamadas > 0 ? stats.duracionTotal / stats.totalLlamadas : 0
                    };
                });

                setStats(newStats);
                setOperatorStats(operatorStats);

                console.log('Estadísticas calculadas:', {
                    totalLlamadas: newStats.totalLlamadas,
                    entrantes: newStats.entrantes,
                    salientes: newStats.salientes,
                    beneficiariosUnicos: newStats.beneficiarios.size,
                    duracionPromedio: Math.round(newStats.duracionPromedio),
                    comunas: Object.fromEntries(newStats.comunas),
                    horasPico: Object.fromEntries(newStats.horasPico),
                    operadoras: operatorStats
                });
            }
        } catch (err) {
            console.error('Error procesando archivo:', err);
            setError(err.message);
        } finally {
            setLoading(false);
            setProgress(0);
        }
    }, [file, processRows]);    // Memoize the upload handler
    const handleFileUploadMemoized = useCallback(handleFileUpload, [handleFileUpload]);

    // Cleanup effect
    useEffect(() => {
        return () => {
            if (uploadTimeout.current) {
                clearTimeout(uploadTimeout.current);
            }
            if (processingTimeout.current) {
                clearTimeout(processingTimeout.current);
            }
        };
    }, []);    // Memoize stats to prevent unnecessary re-renders
    const memoizedStats = useMemo(() => stats, [
        stats?.totalLlamadas,
        stats?.entrantes,
        stats?.salientes,
        stats?.duracionTotal,
        stats?.duracionPromedio,
        stats?.beneficiarios?.size
    ]);

    return (
        <ErrorBoundary>
            <div className="p-6 space-y-6">
                {/* Loading Overlay */}
                {loading && <LoadingOverlay progress={progress} />}
                
                {/* Estadísticas básicas */}
                <StatsDisplay stats={memoizedStats} />                {/* Vista detallada */}
                {stats?.totalLlamadas > 0 && operatorStats && (
                    <DetailedStatsView stats={stats} operatorStats={operatorStats} />
                )}

                {/* Selector de archivo y botones */}
                <div className="bg-white rounded-lg shadow-md p-6">
                    <div className="flex flex-col space-y-4">
                        <div className="flex items-center space-x-4">
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={handleFileChange}
                                className="hidden"
                                id="fileInput"
                                disabled={loading}
                            />
                            <label
                                htmlFor="fileInput"
                                className={`cursor-pointer bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <ArrowUpOnSquareIcon className="h-5 w-5 mr-2" />
                                Elegir archivo
                            </label>
                            {file && (
                                <div className="flex items-center space-x-4 flex-1">
                                    <span className="text-gray-600 flex-1">
                                        archivo - {file.name}
                                    </span>                                    <button
                                        onClick={handleFileUploadMemoized}
                                        disabled={loading || !file}
                                        className={`bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 flex items-center ${(loading || !file) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <ChartBarIcon className="h-5 w-5 mr-2" />
                                        Comenzar Análisis
                                    </button>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
                                <strong className="font-bold">Error: </strong>
                                <span className="block sm:inline">{error}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ErrorBoundary>
    );
}

export default CallDataAnalyzer;
