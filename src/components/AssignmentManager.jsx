import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { read, utils } from 'xlsx';
import { ArrowUpOnSquareIcon, ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline';
import { db } from '../App';

const Toast = ({ message, type, onDismiss }) => {
    const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
    
    useEffect(() => {
        if (message) {
            const timer = setTimeout(() => {
                onDismiss();
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [message, onDismiss]);

    if (!message) return null;

    return (
        <div className={`fixed bottom-5 right-5 text-white px-6 py-3 rounded-lg shadow-lg ${bgColor}`}>
            {message}
        </div>
    );
};

const AssignmentManager = () => {
    const [loading, setLoading] = useState(false);
    const [file, setFile] = useState(null);
    const [toast, setToast] = useState({ message: '', type: '' });
    const [assignments, setAssignments] = useState([]);
    const [operadoras, setOperadoras] = useState([]);
    const [beneficiarios, setBeneficiarios] = useState([]);
    const [selectedOperadora, setSelectedOperadora] = useState('');
    const [selectedBeneficiario, setSelectedBeneficiario] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch teleoperators
                const operadorasSnap = await getDocs(collection(db, 'users'));
                setOperadoras(operadorasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                // Fetch beneficiaries
                const beneficiariosSnap = await getDocs(collection(db, 'beneficiarios'));
                setBeneficiarios(beneficiariosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                // Fetch existing assignments
                const assignmentsSnap = await getDocs(collection(db, 'assignments'));
                setAssignments(assignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                console.error("Error fetching data:", error);
                setToast({ message: `Error al cargar datos: ${error.message}`, type: 'error' });
            }
        };
        fetchData();
    }, []);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const handleFileUpload = async () => {
        if (!file) {
            setToast({ message: 'Por favor, selecciona un archivo', type: 'error' });
            return;
        }

        setLoading(true);
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = utils.sheet_to_json(worksheet);

                // Process each row
                for (const row of json) {
                    const beneficiarioName = row['A']; // Column A = beneficiary name
                    const telefonos = String(row['B']).split(',').map(tel => tel.trim()); // Column B = phone numbers

                    // Find or create beneficiary
                    let beneficiario = beneficiarios.find(b => b.nombre === beneficiarioName);
                    if (!beneficiario) {
                        // Create new beneficiary if not exists
                        const beneficiarioRef = doc(collection(db, 'beneficiarios'));
                        const newBeneficiario = {
                            nombre: beneficiarioName,
                            telefonos: telefonos
                        };
                        await setDoc(beneficiarioRef, newBeneficiario);
                        beneficiario = { id: beneficiarioRef.id, ...newBeneficiario };
                    }

                    // Create or update assignment
                    if (row['C']) { // If column C has operadora name
                        const operadora = operadoras.find(op => op.nombre === row['C']);
                        if (operadora) {
                            const assignmentRef = doc(collection(db, 'assignments'));
                            await setDoc(assignmentRef, {
                                beneficiarioId: beneficiario.id,
                                beneficiarioNombre: beneficiario.nombre,
                                operadoraId: operadora.id,
                                operadoraNombre: operadora.nombre,
                                createdAt: new Date()
                            });
                        }
                    }
                }

                setToast({ message: 'Asignaciones procesadas con éxito', type: 'success' });
                // Refresh assignments
                const assignmentsSnap = await getDocs(collection(db, 'assignments'));
                setAssignments(assignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                console.error("Error processing file:", error);
                setToast({ message: `Error al procesar archivo: ${error.message}`, type: 'error' });
            } finally {
                setLoading(false);
                setFile(null);
                if (document.getElementById('file-upload')) {
                    document.getElementById('file-upload').value = null;
                }
            }
        };

        reader.readAsArrayBuffer(file);
    };

    const handleManualAssignment = async () => {
        if (!selectedOperadora || !selectedBeneficiario) {
            setToast({ message: 'Por favor, selecciona una operadora y un beneficiario', type: 'error' });
            return;
        }

        try {
            const operadora = operadoras.find(op => op.id === selectedOperadora);
            const beneficiario = beneficiarios.find(b => b.id === selectedBeneficiario);

            const assignmentRef = doc(collection(db, 'assignments'));
            await setDoc(assignmentRef, {
                beneficiarioId: beneficiario.id,
                beneficiarioNombre: beneficiario.nombre,
                operadoraId: operadora.id,
                operadoraNombre: operadora.nombre,
                createdAt: new Date()
            });

            setToast({ message: 'Asignación creada con éxito', type: 'success' });
            
            // Refresh assignments
            const assignmentsSnap = await getDocs(collection(db, 'assignments'));
            setAssignments(assignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            // Reset selections
            setSelectedOperadora('');
            setSelectedBeneficiario('');
        } catch (error) {
            console.error("Error creating assignment:", error);
            setToast({ message: `Error al crear asignación: ${error.message}`, type: 'error' });
        }
    };

    const handleDeleteAssignment = async (assignmentId) => {
        if (window.confirm('¿Estás seguro de que quieres eliminar esta asignación?')) {
            try {
                await deleteDoc(doc(db, 'assignments', assignmentId));
                setAssignments(assignments.filter(a => a.id !== assignmentId));
                setToast({ message: 'Asignación eliminada con éxito', type: 'success' });
            } catch (error) {
                console.error("Error deleting assignment:", error);
                setToast({ message: `Error al eliminar asignación: ${error.message}`, type: 'error' });
            }
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-full">
            <Toast message={toast.message} type={toast.type} onDismiss={() => setToast({ message: '', type: '' })} />
            
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4">Carga Masiva de Asignaciones</h2>
                <div className="bg-white p-6 rounded-lg shadow">
                    <p className="text-gray-600 mb-4">
                        Sube un archivo Excel con las asignaciones. El formato debe ser:
                        <br />
                        Columna A: Nombre del beneficiario
                        <br />
                        Columna B: Teléfonos (separados por comas)
                        <br />
                        Columna C: Nombre de la operadora (opcional)
                    </p>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                        <input
                            type="file"
                            id="file-upload"
                            accept=".xlsx,.xls"
                            onChange={handleFileChange}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                    </div>
                    <button
                        onClick={handleFileUpload}
                        disabled={loading || !file}
                        className="mt-4 w-full bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-600 disabled:bg-gray-400"
                    >
                        {loading ? <ArrowPathIcon className="h-5 w-5 animate-spin"/> : <ArrowUpOnSquareIcon className="h-5 w-5"/>}
                        {loading ? 'Procesando...' : 'Subir y Procesar'}
                    </button>
                </div>
            </div>

            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4">Asignación Manual</h2>
                <div className="bg-white p-6 rounded-lg shadow">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Operadora
                            </label>
                            <select
                                value={selectedOperadora}
                                onChange={(e) => setSelectedOperadora(e.target.value)}
                                className="w-full p-2 border rounded-md"
                            >
                                <option value="">Seleccionar operadora</option>
                                {operadoras.map(op => (
                                    <option key={op.id} value={op.id}>{op.nombre}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Beneficiario
                            </label>
                            <select
                                value={selectedBeneficiario}
                                onChange={(e) => setSelectedBeneficiario(e.target.value)}
                                className="w-full p-2 border rounded-md"
                            >
                                <option value="">Seleccionar beneficiario</option>
                                {beneficiarios.map(ben => (
                                    <option key={ben.id} value={ben.id}>{ben.nombre}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <button
                        onClick={handleManualAssignment}
                        className="w-full bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
                    >
                        Crear Asignación
                    </button>
                </div>
            </div>

            <div>
                <h2 className="text-xl font-bold mb-4">Asignaciones Actuales</h2>
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Operadora
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Beneficiario
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Acciones
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {assignments.map(assignment => (
                                <tr key={assignment.id}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {assignment.operadoraNombre}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {assignment.beneficiarioNombre}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <button
                                            onClick={() => handleDeleteAssignment(assignment.id)}
                                            className="text-red-600 hover:text-red-900"
                                        >
                                            <TrashIcon className="h-5 w-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AssignmentManager;
