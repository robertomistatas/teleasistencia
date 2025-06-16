import React, { useState, useEffect, useContext, useCallback, useRef, memo } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { read, utils } from 'xlsx';
import { ArrowUpOnSquareIcon, ArrowPathIcon, TrashIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { db } from '../App';
import { DataContext } from '../App';

// Componente Toast separado
const Toast = memo(({ message, type, onDismiss }) => {
    useEffect(() => {
        if (message) {
            const timer = setTimeout(onDismiss, 3000);
            return () => clearTimeout(timer);
        }
    }, [message, onDismiss]);

    if (!message) return null;

    return (
        <div className={`fixed bottom-5 right-5 text-white px-6 py-3 rounded-lg shadow-lg ${
            type === 'success' ? 'bg-green-500' : 'bg-red-500'
        }`}>
            {message}
        </div>
    );
});

// Componente LoadingOverlay separado
const LoadingOverlay = ({ progress, stats }) => (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex flex-col items-center">
                <ArrowPathIcon className="w-12 h-12 animate-spin text-blue-500 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Procesando archivo...</h3>
                <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                    <div 
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${(progress.processed / progress.total) * 100}%` }}
                    />
                </div>
                <p className="text-sm text-gray-600 mb-2">
                    Procesando {progress.processed} de {progress.total} registros
                </p>
                {stats && (
                    <div className="text-sm space-y-1 text-gray-600 text-center border-t border-gray-200 pt-3 mt-2 w-full">
                        <p>✅ {stats.beneficiariosCreados} nuevos beneficiarios</p>
                        <p>🔄 {stats.duplicadosEncontrados} beneficiarios existentes</p>
                        <p>📋 {stats.asignacionesCreadas} asignaciones creadas</p>
                        {stats.errores > 0 && (
                            <p className="text-red-500">❌ {stats.errores} errores encontrados</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    </div>
);

// Componente para la tarjeta de asignación
const AsignacionCard = memo(({ asignacion, beneficiario, onDelete }) => {
    if (!beneficiario) return null;

    return (
        <div className="flex items-center justify-between py-3 px-4 bg-white border border-gray-100 rounded-lg hover:border-gray-200 transition-colors">
            <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-900">
                    {beneficiario.nombre}
                </span>
                {beneficiario.telefono && (
                    <span className="text-xs text-gray-500 mt-1">
                        📞 {beneficiario.telefono}
                    </span>
                )}
            </div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(asignacion.id, beneficiario.nombre);
                }}
                className="text-red-600 hover:text-red-800 p-2 hover:bg-red-50 rounded-full transition-colors"
                title="Eliminar asignación"
            >
                <TrashIcon className="h-5 w-5" />
            </button>
        </div>
    );
});

// Componente principal
const AssignmentManager = () => {
    // Contexto
    const { updateAssignments } = useContext(DataContext);

    // Estados
    const [loading, setLoading] = useState(true);
    const [operadoras, setOperadoras] = useState([]);
    const [beneficiarios, setBeneficiarios] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [selectedOperadora, setSelectedOperadora] = useState('');
    const [selectedBeneficiario, setSelectedBeneficiario] = useState('');
    const [expandedOperadora, setExpandedOperadora] = useState(null);
    const [file, setFile] = useState(null);
    const [toast, setToast] = useState({ message: '', type: '' });    // Estados adicionales para el manejo de carga
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ total: 0, processed: 0 });
    const [uploadStats, setUploadStats] = useState({
        beneficiariosCreados: 0,
        duplicadosEncontrados: 0,
        asignacionesCreadas: 0,
        errores: 0
    });

    // Referencias
    const loadingStatus = useRef({
        operadoras: false,
        beneficiarios: false,
        asignaciones: false
    });

    // Callbacks
    const checkDataLoaded = useCallback(() => {
        const status = loadingStatus.current;
        if (status.operadoras && status.beneficiarios && status.asignaciones) {
            setLoading(false);
        }
    }, []);

    const handleCreateAssignment = useCallback(async () => {
        if (!selectedOperadora || !selectedBeneficiario) return;

        try {
            const operadora = operadoras.find(op => op.id === selectedOperadora);
            const beneficiario = beneficiarios.find(b => b.id === selectedBeneficiario);

            if (!operadora || !beneficiario) {
                setToast({ message: 'Error: Operadora o beneficiario no encontrado', type: 'error' });
                return;
            }

            const newAssignment = {
                operadoraId: selectedOperadora,
                beneficiarioId: selectedBeneficiario,
                createdAt: new Date().toISOString()
            };

            const assignmentRef = doc(collection(db, 'asignaciones'));
            await setDoc(assignmentRef, newAssignment);

            setSelectedOperadora('');
            setSelectedBeneficiario('');
            setToast({ message: 'Asignación creada con éxito', type: 'success' });
        } catch (error) {
            console.error('Error creating assignment:', error);
            setToast({ message: 'Error al crear la asignación', type: 'error' });
        }
    }, [selectedOperadora, selectedBeneficiario, operadoras, beneficiarios]);

    const handleDeleteAssignment = useCallback(async (assignmentId, beneficiarioNombre) => {
        try {
            await deleteDoc(doc(db, 'asignaciones', assignmentId));
            setToast({ 
                message: `Asignación de ${beneficiarioNombre} eliminada con éxito`, 
                type: 'success' 
            });
        } catch (error) {
            console.error('Error deleting assignment:', error);
            setToast({ message: 'Error al eliminar la asignación', type: 'error' });
        }
    }, []);    const validateBeneficiario = async (nombre, telefono) => {
        // Buscar beneficiarios existentes con el mismo nombre o teléfono
        const beneficiariosRef = collection(db, 'beneficiarios');
        const nombreQuery = query(beneficiariosRef, where('nombre', '==', nombre.trim()));
        const telefonoQuery = telefono ? 
            query(beneficiariosRef, where('telefono', '==', telefono.trim())) : 
            null;

        const [nombreSnapshot, telefonoSnapshot] = await Promise.all([
            getDocs(nombreQuery),
            telefonoQuery ? getDocs(telefonoQuery) : Promise.resolve({ empty: true })
        ]);

        if (!nombreSnapshot.empty) {
            const existente = nombreSnapshot.docs[0];
            return {
                existe: true,
                id: existente.id,
                data: existente.data()
            };
        }

        if (telefonoQuery && !telefonoSnapshot.empty) {
            const existente = telefonoSnapshot.docs[0];
            return {
                existe: true,
                id: existente.id,
                data: existente.data()
            };
        }

        return { existe: false };
    };

    const handleFileUpload = useCallback(async () => {
        if (!file || !selectedOperadora) return;
        
        try {
            setIsUploading(true);
            const data = await file.arrayBuffer();
            const workbook = read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = utils.sheet_to_json(worksheet, { header: ['nombre', 'telefono'] });
            
            // Skip header row
            const dataRows = rows.slice(1);
            setUploadProgress({ total: dataRows.length, processed: 0 });

            // Primero, verificar si hay asignaciones existentes para esta operadora
            const asignacionesRef = collection(db, 'asignaciones');
            const asignacionesQuery = query(asignacionesRef, where('operadoraId', '==', selectedOperadora));
            const asignacionesSnapshot = await getDocs(asignacionesQuery);
            
            // Eliminar asignaciones existentes si las hay
            const batch = writeBatch(db);
            asignacionesSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
              // Reiniciar estadísticas
            setUploadStats({
                beneficiariosCreados: 0,
                duplicadosEncontrados: 0,
                asignacionesCreadas: 0,
                errores: 0
            });
            
            for (const [index, row] of dataRows.entries()) {
                if (!row.nombre) continue;
                
                try {
                    setUploadProgress(prev => ({ ...prev, processed: index + 1 }));

                    // Validar si el beneficiario ya existe
                    const telefonos = row.telefono ? 
                        row.telefono.toString().split(',').map(t => t.trim()).filter(t => t) : 
                        [];
                    
                    const beneficiarioExistente = await validateBeneficiario(row.nombre, telefonos[0]);
                    let beneficiarioId;                    if (beneficiarioExistente.existe) {
                        setUploadStats(prev => ({
                            ...prev,
                            duplicadosEncontrados: prev.duplicadosEncontrados + 1
                        }));
                        beneficiarioId = beneficiarioExistente.id;
                    } else {
                        // Crear nuevo beneficiario
                        const beneficiarioRef = doc(collection(db, 'beneficiarios'));
                        await setDoc(beneficiarioRef, {
                            nombre: row.nombre.trim(),
                            telefono: telefonos[0] || '',
                            telefonos: telefonos,
                            createdAt: new Date().toISOString()
                        });
                        setUploadStats(prev => ({
                            ...prev,
                            beneficiariosCreados: prev.beneficiariosCreados + 1
                        }));
                        beneficiarioId = beneficiarioRef.id;
                    }

                    // Crear asignación
                    const asignacionRef = doc(collection(db, 'asignaciones'));
                    await setDoc(asignacionRef, {
                        operadoraId: selectedOperadora,
                        beneficiarioId: beneficiarioId,
                        createdAt: new Date().toISOString()
                    });
                    setUploadStats(prev => ({
                        ...prev,
                        asignacionesCreadas: prev.asignacionesCreadas + 1
                    }));

                } catch (error) {
                    console.error(`Error procesando fila ${row.nombre}:`, error);
                    setUploadStats(prev => ({
                        ...prev,
                        errores: prev.errores + 1
                    }));
                }
            }
            
            setFile(null);
            setSelectedOperadora('');            const stats = uploadStats;
            let message = `Proceso completado: ${stats.beneficiariosCreados} beneficiarios nuevos, ${stats.duplicadosEncontrados} existentes, ${stats.asignacionesCreadas} asignaciones creadas`;
            if (stats.errores > 0) {
                message += `, ${stats.errores} errores encontrados`;
            }
            
            setToast({ message, type: stats.errores > 0 ? 'error' : 'success' });
        } catch (error) {
            console.error('Error procesando archivo:', error);
            setToast({ message: 'Error procesando archivo', type: 'error' });
        } finally {
            setIsUploading(false);
            setUploadProgress({ total: 0, processed: 0 });
            setUploadStats({
                beneficiariosCreados: 0,
                duplicadosEncontrados: 0,
                asignacionesCreadas: 0,
                errores: 0
            });
        }
    }, [file, selectedOperadora]);

    // Efectos
    useEffect(() => {
        let isMounted = true;
        const unsubscribes = [];

        const setupSubscriptions = async () => {
            try {
                // Suscripción a operadoras
                const operadorasQuery = query(collection(db, 'users'));
                const unsubOperadoras = onSnapshot(operadorasQuery, (snapshot) => {
                    if (!isMounted) return;
                    
                    const operadorasData = snapshot.docs
                        .map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }))
                        .filter(user => user.rol === 'teleoperadora');

                    setOperadoras(operadorasData);
                    loadingStatus.current.operadoras = true;
                    checkDataLoaded();
                });
                unsubscribes.push(unsubOperadoras);

                // Suscripción a beneficiarios
                const beneficiariosQuery = query(collection(db, 'beneficiarios'));
                const unsubBeneficiarios = onSnapshot(beneficiariosQuery, (snapshot) => {
                    if (!isMounted) return;
                    
                    const beneficiariosData = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    setBeneficiarios(beneficiariosData);
                    loadingStatus.current.beneficiarios = true;
                    checkDataLoaded();
                });
                unsubscribes.push(unsubBeneficiarios);

                // Suscripción a asignaciones
                const asignacionesQuery = query(collection(db, 'asignaciones'));
                const unsubAsignaciones = onSnapshot(asignacionesQuery, (snapshot) => {
                    if (!isMounted) return;
                    
                    const assignmentsData = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    setAssignments(assignmentsData);
                    loadingStatus.current.asignaciones = true;
                    checkDataLoaded();
                });
                unsubscribes.push(unsubAsignaciones);

            } catch (error) {
                console.error('Error setting up subscriptions:', error);
                if (isMounted) {
                    setToast({ message: 'Error cargando datos', type: 'error' });
                    setLoading(false);
                }
            }
        };

        setupSubscriptions();

        return () => {
            isMounted = false;
            unsubscribes.forEach(unsub => unsub());
        };
    }, [checkDataLoaded]);

    // Loading state
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-8">
                <div className="flex items-center mb-4">
                    <ArrowPathIcon className="w-8 h-8 animate-spin text-blue-500" />
                    <span className="ml-2">Cargando datos...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">            {/* File upload section */}
            <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Carga Masiva de Asignaciones</h3>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Seleccionar Teleoperadora
                        </label>
                        <select
                            value={selectedOperadora}
                            onChange={(e) => setSelectedOperadora(e.target.value)}
                            className="w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                        >
                            <option value="">Seleccionar operadora para asignación masiva</option>
                            {operadoras.map(op => (
                                <option key={op.id} value={op.id}>{op.nombre}</option>
                            ))}
                        </select>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Formato del Excel:</h4>
                        <div className="space-y-2">
                            <p className="text-xs text-gray-600">
                                • Columna A: Nombre del beneficiario
                            </p>
                            <p className="text-xs text-gray-600">
                                • Columna B: Teléfonos (separados por comas)
                            </p>
                            <p className="text-xs text-gray-500 italic">
                                Nota: Los beneficiarios serán asignados a la teleoperadora seleccionada
                            </p>
                        </div>
                    </div>

                    <input
                        type="file"
                        onChange={(e) => setFile(e.target.files[0])}
                        accept=".xlsx,.xls"
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <button
                        onClick={handleFileUpload}
                        disabled={!file || !selectedOperadora}
                        className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                        <ArrowUpOnSquareIcon className="h-5 w-5 mr-2" />
                        Subir y Procesar Asignaciones
                    </button>
                </div>
            </div>

            {/* Manual assignment section */}
            <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Asignación Manual</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Operadora</label>
                        <select
                            value={selectedOperadora}
                            onChange={(e) => setSelectedOperadora(e.target.value)}
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                        >
                            <option value="">Seleccionar operadora</option>
                            {operadoras.map(op => (
                                <option key={op.id} value={op.id}>{op.nombre}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Beneficiario</label>
                        <select
                            value={selectedBeneficiario}
                            onChange={(e) => setSelectedBeneficiario(e.target.value)}
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                        >
                            <option value="">Seleccionar beneficiario</option>
                            {beneficiarios.map(b => (
                                <option key={b.id} value={b.id}>{b.nombre}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <button
                    onClick={handleCreateAssignment}
                    disabled={!selectedOperadora || !selectedBeneficiario}
                    className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                    Crear Asignación
                </button>
            </div>

            {/* Current assignments section */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold">Asignaciones Actuales</h3>
                </div>
                <div className="divide-y divide-gray-200">
                    {operadoras.map(op => {
                        const asignaciones = assignments.filter(a => a.operadoraId === op.id);
                        
                        return (
                            <div key={op.id} className="p-6 border-b border-gray-200 last:border-b-0">
                                <div 
                                    className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-3 rounded-lg transition-colors"
                                    onClick={() => setExpandedOperadora(expandedOperadora === op.id ? null : op.id)}
                                >
                                    <div className="flex items-center space-x-3">
                                        <h4 className="text-lg font-medium text-gray-900">{op.nombre}</h4>
                                        <div className={`px-3 py-1 text-sm font-medium rounded-full ${
                                            asignaciones.length > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                        }`}>
                                            {asignaciones.length} beneficiarios
                                        </div>
                                    </div>
                                    <ChevronDownIcon 
                                        className={`h-5 w-5 text-gray-500 transform transition-transform duration-200 ${
                                            expandedOperadora === op.id ? 'rotate-180' : ''
                                        }`} 
                                    />
                                </div>
                                
                                {expandedOperadora === op.id && (
                                    <div className="mt-4 space-y-2 pl-4">
                                        {asignaciones.length === 0 ? (
                                            <p className="text-sm text-gray-500 italic py-4">
                                                No hay beneficiarios asignados a esta operadora
                                            </p>
                                        ) : (
                                            <div className="space-y-2">
                                                {asignaciones.map(asignacion => {
                                                    const beneficiario = beneficiarios.find(b => b.id === asignacion.beneficiarioId);
                                                    return (
                                                        <AsignacionCard
                                                            key={asignacion.id}
                                                            asignacion={asignacion}
                                                            beneficiario={beneficiario}
                                                            onDelete={handleDeleteAssignment}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <Toast 
                message={toast.message}
                type={toast.type}
                onDismiss={() => setToast({ message: '', type: '' })}
            />

            {isUploading && <LoadingOverlay progress={uploadProgress} stats={uploadStats} />}
        </div>
    );
};

export default AssignmentManager;
