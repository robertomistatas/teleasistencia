import React, { useState, useCallback, useRef, useEffect, useMemo, useContext } from 'react';
import { read, utils } from 'xlsx';
import { ArrowUpOnSquareIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import StatsDisplay from './StatsDisplay';
import DetailedStatsView from './DetailedStatsView';
import ErrorBoundary from './ErrorBoundary';
import { DataContext } from '../App';
import { db } from '../App';

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
    const { assignments, updateCallData } = useContext(DataContext);
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [progress, setProgress] = useState(0);
    const [waitingForAssignments, setWaitingForAssignments] = useState(false);
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
    const processingTimeout = useRef(null);    // Cache para asignaciones
    const assignmentCache = useRef(new Map());

    // Función para limpiar el caché cuando cambian las asignaciones
    useEffect(() => {
        assignmentCache.current.clear();
    }, [assignments]);

    // Función para normalizar texto
    const normalizeText = useCallback((text) => {
        return text?.toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ') || '';
    }, []);

    // Función para obtener la teleoperadora asignada a un beneficiario
    const getTeleoperadora = useCallback((telefono, nombre) => {
        if (!assignments?.asignaciones || Object.keys(assignments.asignaciones).length === 0) {
            console.warn('No hay asignaciones disponibles o están vacías:', assignments);
            return 'No identificada';
        }

        // Normalizar el teléfono y el nombre para la búsqueda
        const normalizedTelefono = telefono?.toString().trim();
        const normalizedNombre = normalizeText(nombre);

        // Verificar el caché primero
        const cacheKey = `${normalizedNombre}|${normalizedTelefono}`;
        if (assignmentCache.current.has(cacheKey)) {
            return assignmentCache.current.get(cacheKey);
        }

        if (!normalizedTelefono && !normalizedNombre) {
            console.warn('Teléfono y nombre vacíos');
            return 'No identificada';
        }

        // Buscar en las asignaciones de cada operadora
        let teleoperadoraEncontrada = 'No identificada';
        
        Object.entries(assignments.asignaciones).forEach(([operadoraNombre, asignaciones]) => {
            if (!Array.isArray(asignaciones)) {
                console.warn(`Asignaciones no válidas para ${operadoraNombre}`);
                return;
            }

            asignaciones.forEach(asignacion => {
                if (!asignacion || teleoperadoraEncontrada !== 'No identificada') return;

                try {
                    // Verificar coincidencia por nombre
                    const nombreCoincide = normalizedNombre && asignacion.beneficiario && 
                        normalizeText(asignacion.beneficiario) === normalizedNombre;

                    // Verificar coincidencia por teléfono
                    const telefonoCoincide = normalizedTelefono && asignacion.telefonos && 
                        Array.isArray(asignacion.telefonos) &&
                        asignacion.telefonos.some(tel => 
                            normalizeText(tel) === normalizedTelefono
                        );

                    if (nombreCoincide || telefonoCoincide) {
                        console.log(`Coincidencia encontrada para ${operadoraNombre}:`, {
                            beneficiario: nombre,
                            telefono: telefono,
                            tipo: nombreCoincide ? 'por nombre' : 'por teléfono'
                        });
                        teleoperadoraEncontrada = operadoraNombre;
                    }
                } catch (error) {
                    console.error('Error procesando asignación:', error, {
                        operadora: operadoraNombre,
                        asignacion: asignacion
                    });
                }
            });
        });
        
        // Guardar en caché el resultado
        assignmentCache.current.set(cacheKey, teleoperadoraEncontrada);
        
        if (teleoperadoraEncontrada === 'No identificada') {
            console.log('No se encontró asignación para:', {
                beneficiario: nombre,
                telefono: telefono,
                normalizedNombre: normalizedNombre,
                normalizedTelefono: normalizedTelefono
            });
        }
        
        return teleoperadoraEncontrada;
    }, [assignments?.asignaciones, normalizeText]);

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

    // Función para parsear correctamente la fecha del formato DD-MM-YYYY
    const parseDate = useCallback((dateStr) => {
        if (!dateStr) return null;
        try {
            const [day, month, year] = dateStr.split('-').map(num => num.trim());
            return new Date(year, month - 1, day);
        } catch (error) {
            console.error('Error parsing date:', dateStr, error);
            return null;
        }
    }, []);

    // Función para determinar si una llamada fue exitosa
    const isCallSuccessful = useCallback((resultado) => {
        if (!resultado) return false;
        const resultadoLower = resultado.toString().toLowerCase().trim();
        
        // Patrones comunes de llamadas exitosas
        const exitosoPatterns = [
            'exitoso',
            'llamado exitoso',
            /^\d+\s*llamado exitoso/,  // Para casos como "222 Llamado exitoso"
            /llamado\s+exitoso\s+\d+/  // Para casos como "Llamado exitoso 222"
        ];
        
        return exitosoPatterns.some(pattern => {
            if (pattern instanceof RegExp) {
                return pattern.test(resultadoLower);
            }
            return resultadoLower.includes(pattern);
        });
    }, []);    const processRowsChunk = useCallback((rows, startIdx, endIdx, colIndexes) => {
        // Crear un mapa inicial de operadoras desde las asignaciones
        const operadorasMap = new Map();
        
        if (assignments?.asignaciones) {
            // Primero, inicializar todas las operadoras con sus métricas
            Object.keys(assignments.asignaciones).forEach(operadora => {
                operadorasMap.set(operadora, {
                    totalLlamadas: 0,
                    entrantes: 0,
                    salientes: 0,
                    duracionTotal: 0,
                    beneficiarios: new Set(),
                    fechas: new Set(),
                    llamadasExitosas: 0,
                    promedioDiario: 0
                });
            });

            // Pre-mapear beneficiarios a operadoras para búsqueda rápida
            Object.entries(assignments.asignaciones).forEach(([operadora, asignaciones]) => {
                asignaciones.forEach(asignacion => {
                    if (asignacion?.beneficiario) {
                        const normalizedBeneficiario = normalizeText(asignacion.beneficiario);
                        assignmentCache.current.set(`beneficiario:${normalizedBeneficiario}`, operadora);
                        
                        // También mapear por teléfono
                        if (asignacion.telefonos && Array.isArray(asignacion.telefonos)) {
                            asignacion.telefonos.forEach(tel => {
                                const normalizedTel = tel?.toString().trim();
                                if (normalizedTel) {
                                    assignmentCache.current.set(`telefono:${normalizedTel}`, operadora);
                                }
                            });
                        }
                    }
                });
            });
        }

        // Agregar "No identificada" al mapa
        operadorasMap.set('No identificada', {
            totalLlamadas: 0,
            entrantes: 0,
            salientes: 0,
            duracionTotal: 0,
            beneficiarios: new Set(),
            fechas: new Set(),
            llamadasExitosas: 0,
            promedioDiario: 0
        });

        const stats = {
            totalLlamadas: 0,
            entrantes: 0,
            salientes: 0,
            duracionTotal: 0,
            duracionPromedio: 0,
            beneficiarios: new Set(),
            comunas: new Map(),
            horasPico: new Map(),
            operadoras: operadorasMap,
            llamadasExitosas: 0
        };

        for (let i = startIdx; i < Math.min(endIdx, rows.length); i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            try {
                const evento = row[colIndexes.evento]?.toString().toLowerCase() || '';
                const beneficiario = row[colIndexes.beneficiario]?.toString() || 'No identificado';
                const comuna = row[colIndexes.comuna]?.toString() || 'Sin comuna';
                const horaInicio = row[colIndexes.ini]?.toString() || '';
                const segundos = parseInt(row[colIndexes.seg], 10) || 0;
                const fechaStr = row[colIndexes.fecha]?.toString() || '';
                const fecha = parseDate(fechaStr);
                const telefono = row[colIndexes.fono]?.toString() || '';
                const resultado = row[colIndexes.resultado]?.toString() || '';
                const exitoso = isCallSuccessful(resultado);
                
                // Solo procesar si tenemos una fecha válida
                if (!fecha) {
                    console.warn('Fecha inválida:', fechaStr);
                    continue;
                }

                // Identificar teleoperadora
                const teleoperadora = getTeleoperadora(telefono, beneficiario);
                
                // Actualizar estadísticas generales
                stats.totalLlamadas++;
                if (exitoso) stats.llamadasExitosas++;
                
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
                }                // Actualizar estadísticas por operadora
                const operadoraStats = stats.operadoras.get(teleoperadora);
                if (operadoraStats) {
                    operadoraStats.totalLlamadas++;
                    if (exitoso) operadoraStats.llamadasExitosas++;
                    operadoraStats.duracionTotal += segundos;
                    if (evento.includes('entrante')) {
                        operadoraStats.entrantes++;
                    } else {
                        operadoraStats.salientes++;
                    }
                    if (fecha) {
                        operadoraStats.fechas.add(fechaStr);
                    }
                    if (beneficiario !== 'No identificado') {
                        operadoraStats.beneficiarios.add(beneficiario);
                    }
                    
                    // Actualizar promedio diario
                    const diasTrabajados = operadoraStats.fechas.size || 1;
                    operadoraStats.promedioDiario = operadoraStats.totalLlamadas / diasTrabajados;
                }

            } catch (err) {
                console.warn('Error procesando fila:', i + 1, err);
            }
        }

        return stats;
    }, [assignments?.asignaciones, getTeleoperadora, isCallSuccessful, parseDate]);

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
                observacion: getColIndex('observación') || getColIndex('observacion'),
                resultado: getColIndex('resultado')
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

            if (newStats) {                // Procesar estadísticas por operadora
                const operatorStats = {};
                newStats.operadoras.forEach((stats, operadora) => {
                    const diasTrabajados = stats.fechas.size || 1;
                    operatorStats[operadora] = {
                        totalLlamadas: stats.totalLlamadas,
                        entrantes: stats.entrantes,
                        salientes: stats.salientes,
                        duracionTotal: stats.duracionTotal,
                        diasTrabajados: diasTrabajados,
                        promedioDiario: (stats.totalLlamadas / diasTrabajados).toFixed(1),
                        duracionPromedio: stats.totalLlamadas > 0 ? Math.round(stats.duracionTotal / stats.totalLlamadas) : 0,
                        llamadasExitosas: stats.llamadasExitosas,
                        beneficiariosUnicos: stats.beneficiarios.size
                    };
                });// Actualizar estado local
                setStats(newStats);
                setOperatorStats(operatorStats);

                // Guardar datos en Firebase
                await saveCallData(newStats, operatorStats, rows);                // Preparar datos para el contexto global
                const processedCalls = rows.slice(1).map((row, index) => {
                    const resultado = row[colIndexes.resultado]?.toString() || '';
                    return {
                        id: row[colIndexes.id]?.toString() || index.toString(),
                        fecha: row[colIndexes.fecha]?.toString() || '',
                        beneficiario: row[colIndexes.beneficiario]?.toString() || '',
                        comuna: row[colIndexes.comuna]?.toString() || '',
                        evento: row[colIndexes.evento]?.toString().toLowerCase() || '',
                        fono: row[colIndexes.fono]?.toString() || '',
                        segundos: parseInt(row[colIndexes.seg], 10) || 0,
                        resultado: resultado,
                        exitoso: isCallSuccessful(resultado),
                        teleoperadora: getTeleoperadora(
                            row[colIndexes.fono]?.toString() || '',
                            row[colIndexes.beneficiario]?.toString() || ''
                        )
                    };
                });

                // Actualizar el contexto global
                updateCallData(processedCalls);

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
    const handleFileUploadMemoized = useCallback(handleFileUpload, [handleFileUpload]);    // Efecto para cargar datos existentes
    useEffect(() => {
        const loadExistingData = async () => {
            try {
                const callsRef = collection(db, 'llamadas');
                const snapshot = await getDocs(callsRef);
                
                if (!snapshot.empty) {
                    // Get the most recent upload
                    const lastUpload = snapshot.docs
                        .map(doc => ({ ...doc.data(), id: doc.id }))
                        .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate))[0];

                    if (lastUpload && lastUpload.stats) {
                        try {
                            // Convert the stats from Firestore format
                            const convertedStats = convertFirestoreToStats(lastUpload.stats);
                            
                            // Validate that the conversion worked
                            if (convertedStats && 
                                convertedStats.beneficiarios instanceof Set &&
                                convertedStats.comunas instanceof Map &&
                                convertedStats.horasPico instanceof Map &&
                                convertedStats.operadoras instanceof Map) {
                                
                                setStats(convertedStats);
                                setOperatorStats(lastUpload.operatorStats || {});

                                // Update global context with the most recent data
                                if (lastUpload.rawData && Array.isArray(lastUpload.rawData)) {
                                    try {
                                        const processedCalls = lastUpload.rawData.map(row => ({                                            id: row.id || '',
                                            fecha: row.fecha || '',
                                            beneficiario: row.beneficiario || '',
                                            comuna: row.comuna || '',
                                            evento: row.evento?.toLowerCase() || '',
                                            fono: row.fono || '',
                                            segundos: parseInt(row.seg, 10) || 0,
                                            resultado: row.resultado || '',
                                            exitoso: isCallSuccessful(row.resultado || ''),
                                            teleoperadora: getTeleoperadora(
                                                row.fono || '',
                                                row.beneficiario || ''
                                            )
                                        }));
                                        updateCallData(processedCalls);
                                    } catch (processError) {
                                        console.error('Error processing raw call data:', processError);
                                    }
                                }
                            } else {
                                throw new Error('Data conversion failed - invalid data structure');
                            }
                        } catch (conversionError) {
                            console.error('Error converting stats from Firestore:', conversionError);
                            // Initialize empty stats as fallback
                            setStats({
                                totalLlamadas: 0,
                                entrantes: 0,
                                salientes: 0,
                                duracionTotal: 0,
                                duracionPromedio: 0,
                                beneficiarios: new Set(),
                                comunas: new Map(),
                                horasPico: new Map(),
                                operadoras: new Map()
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('Error loading existing data:', error);
            }
        };

        loadExistingData();
    }, [getTeleoperadora, updateCallData]);

    // Función para preparar datos para Firebase
    const prepareStatsForFirestore = (stats) => {
        // Deep clone the stats object to avoid modifying the original
        const firebaseStats = {...stats};

        // Convert Set to Array
        if (stats.beneficiarios instanceof Set) {
            firebaseStats.beneficiarios = Array.from(stats.beneficiarios);
        }

        // Convert Map to plain object
        if (stats.comunas instanceof Map) {
            firebaseStats.comunas = Object.fromEntries(stats.comunas);
        }

        if (stats.horasPico instanceof Map) {
            firebaseStats.horasPico = Object.fromEntries(stats.horasPico);
        }

        // Handle the nested operadoras Map
        if (stats.operadoras instanceof Map) {
            firebaseStats.operadoras = Object.fromEntries(
                Array.from(stats.operadoras).map(([key, value]) => [
                    key,
                    {
                        ...value,
                        fechas: value.fechas instanceof Set ? Array.from(value.fechas) : value.fechas,
                    }
                ])
            );
        }

        return firebaseStats;
    };

    // Función para convertir datos de Firestore a Sets y Maps
    const convertFirestoreToStats = (firestoreStats) => {
        return {
            ...firestoreStats,
            beneficiarios: new Set(firestoreStats.beneficiarios),
            comunas: new Map(Object.entries(firestoreStats.comunas)),
            horasPico: new Map(Object.entries(firestoreStats.horasPico)),
            operadoras: new Map(
                Object.entries(firestoreStats.operadoras).map(([key, value]) => [
                    key,
                    {
                        ...value,
                        beneficiarios: new Set(value.beneficiarios),
                        fechas: new Set(value.fechas)
                    }
                ])
            )
        };
    };

    // Función para convertir estructuras de datos complejas a formato Firestore
    const convertStatsForFirestore = (stats) => {
        // Convertir las estructuras de datos complejas a formatos que Firestore pueda manejar
        const convertedStats = {
            totalLlamadas: stats.totalLlamadas,
            entrantes: stats.entrantes,
            salientes: stats.salientes,
            duracionTotal: stats.duracionTotal,
            duracionPromedio: stats.duracionPromedio,
            llamadasExitosas: stats.llamadasExitosas,
            beneficiarios: Array.from(stats.beneficiarios),
            comunas: Object.fromEntries(stats.comunas),
            horasPico: Object.fromEntries(stats.horasPico),
            operadoras: Object.fromEntries(
                Array.from(stats.operadoras).map(([key, value]) => [
                    key,
                    {
                        totalLlamadas: value.totalLlamadas,
                        entrantes: value.entrantes,
                        salientes: value.salientes,
                        duracionTotal: value.duracionTotal,
                        duracionPromedio: value.duracionPromedio || 0,
                        llamadasExitosas: value.llamadasExitosas,
                        promedioDiario: value.promedioDiario || 0,
                        beneficiarios: Array.from(value.beneficiarios),
                        fechas: Array.from(value.fechas)
                    }
                ])
            )
        };
        return convertedStats;
    };

    // Función para guardar datos en Firebase
    const saveCallData = async (stats, operatorStats, rawData) => {
        try {
            const docRef = doc(db, 'llamadas', crypto.randomUUID());
            const convertedStats = convertStatsForFirestore(stats);
            
            // Convertir las fechas del rawData a strings ISO
            const processedRawData = rawData.map(row => ({
                ...row,
                fecha: row.fecha ? new Date(row.fecha).toISOString() : null
            }));

            await setDoc(docRef, {
                stats: convertedStats,
                operatorStats,
                rawData: processedRawData,
                uploadDate: new Date().toISOString()
            });
        } catch (err) {
            console.error('Error saving call data:', err);
            throw new Error('Failed to save call data: ' + err.message);
        }
    };

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
                
                {/* Esperando asignaciones */}
                {waitingForAssignments && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <p className="text-sm text-yellow-700">
                                    Cargando asignaciones de teleoperadoras...
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Estadísticas básicas */}
                <StatsDisplay stats={stats} />                {/* Vista detallada */}
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
                                disabled={loading || waitingForAssignments}
                            />
                            <label
                                htmlFor="fileInput"
                                className={`cursor-pointer bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center ${(loading || waitingForAssignments) ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <ArrowUpOnSquareIcon className="h-5 w-5 mr-2" />
                                Elegir archivo
                            </label>
                            {file && (
                                <div className="flex items-center space-x-4 flex-1">
                                    <span className="text-gray-600 flex-1">
                                        archivo - {file.name}
                                    </span>
                                    <button
                                        onClick={handleFileUpload}
                                        disabled={loading || waitingForAssignments || !file}
                                        className={`bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 flex items-center ${(loading || waitingForAssignments || !file) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        Procesar archivo
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ErrorBoundary>
    );
}

export default CallDataAnalyzer;
