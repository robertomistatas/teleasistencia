import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, query, where } from 'firebase/firestore';
import { read, utils } from 'xlsx';
import { ArrowUpOnSquareIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { db } from '../App';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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

const CallDataAnalyzer = () => {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState({ message: '', type: '' });
    const [operadoras, setOperadoras] = useState([]);
    const [selectedOperadora, setSelectedOperadora] = useState('');
    const [llamados, setLlamados] = useState([]);
    const [selectedDateRange, setSelectedDateRange] = useState({
        start: '',
        end: new Date().toISOString().split('T')[0]
    });

    // Initial data load
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch teleoperators
                const operadorasSnap = await getDocs(collection(db, 'users'));
                setOperadoras(operadorasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                // Fetch call logs for the last 30 days
                const endDate = new Date();
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
                const llamadosSnap = await getDocs(collection(db, 'llamados'));
                setLlamados(llamadosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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

                // Process each call record
                for (const row of json) {                    // Parse the date from Excel
                    const rawDate = row['B'];
                    let fecha;
                    if (rawDate instanceof Date) {
                        fecha = rawDate;
                    } else if (typeof rawDate === 'number') {
                        // Excel stores dates as number of days since January 1, 1900
                        fecha = new Date((rawDate - 25569) * 86400 * 1000);
                    } else {
                        fecha = new Date(rawDate);
                    }

                    // Parse time values
                    const parseExcelTime = (timeValue) => {
                        if (!timeValue) return null;
                        
                        // If it's a string in format HH:mm, return as is
                        if (typeof timeValue === 'string' && timeValue.includes(':')) {
                            return timeValue;
                        }
                        
                        // If it's a number (Excel stores times as fraction of 24 hours)
                        if (typeof timeValue === 'number') {
                            const totalSeconds = Math.round(timeValue * 24 * 60 * 60);
                            const hours = Math.floor(totalSeconds / 3600);
                            const minutes = Math.floor((totalSeconds % 3600) / 60);
                            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                        }
                        
                        return null;
                    };

                    const horaInicio = parseExcelTime(row['G']);
                    const horaFin = parseExcelTime(row['H']);

                    const callRecord = {
                        idLlamado: row['A'] || '',
                        fecha: fecha,
                        beneficiarioNombre: row['C'],
                        comuna: row['D'],
                        tipo: (row['E'] || '').toLowerCase(), // entrante/saliente
                        telefono: row['F'],
                        horaInicio: horaInicio,
                        horaFin: horaFin,
                        segundos: parseInt(row['I']) || 0
                    };

                    // Create new call record
                    const callRef = doc(collection(db, 'llamados'));
                    await setDoc(callRef, callRecord);
                }

                // Refresh call logs
                const llamadosSnap = await getDocs(collection(db, 'llamados'));
                setLlamados(llamadosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                setToast({ message: `Registros de llamadas cargados con éxito`, type: 'success' });
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
    };    // Calculate statistics
    const getCallStats = () => {
        let filteredCalls = llamados;

        if (selectedDateRange.start) {
            const startDate = new Date(selectedDateRange.start);
            filteredCalls = filteredCalls.filter(call => call.fecha >= startDate);
        }

        if (selectedDateRange.end) {
            const endDate = new Date(selectedDateRange.end);
            endDate.setHours(23, 59, 59);
            filteredCalls = filteredCalls.filter(call => call.fecha <= endDate);
        }const stats = {
                    totalCalls: filteredCalls.length,
                    incomingCalls: filteredCalls.filter(call => call.tipo === 'entrante').length,
                    outgoingCalls: filteredCalls.filter(call => call.tipo === 'saliente').length,
                    totalDuration: filteredCalls.reduce((acc, call) => acc + (call.segundos || 0), 0),
                    averageDuration: filteredCalls.length 
                        ? Math.round(filteredCalls.reduce((acc, call) => acc + (call.segundos || 0), 0) / filteredCalls.length) 
                        : 0,
                    uniqueBeneficiaries: new Set(filteredCalls.map(call => call.beneficiarioNombre)).size
        };

        return stats;
    };    const getTimeData = () => {
        let filteredCalls = llamados;
        if (selectedDateRange.start) {
            filteredCalls = filteredCalls.filter(call => call.fecha >= new Date(selectedDateRange.start));
        }
        if (selectedDateRange.end) {
            const endDate = new Date(selectedDateRange.end);
            endDate.setHours(23, 59, 59);
            filteredCalls = filteredCalls.filter(call => call.fecha <= endDate);
        }
        
        // Group calls by date
        const callsByDate = {};
        filteredCalls.forEach(call => {
            const date = call.fecha.toLocaleDateString();
            if (!callsByDate[date]) {
                callsByDate[date] = {
                    date,
                    totalCalls: 0,
                    entrantes: 0,
                    salientes: 0,
                    totalDuration: 0,
                    uniqueBeneficiarios: new Set()
                };
            }
            callsByDate[date].totalCalls++;
            callsByDate[date].totalDuration += call.segundos || 0;
            if (call.tipo === 'entrante') {
                callsByDate[date].entrantes++;
            } else {
                callsByDate[date].salientes++;
            }
            callsByDate[date].uniqueBeneficiarios.add(call.beneficiarioNombre);
        });

        return Object.values(callsByDate).sort((a, b) => a.date.localeCompare(b.date));
    };

    const stats = getCallStats();
    const timeData = getTimeData();

    return (
        <div className="p-6 bg-gray-50 min-h-full">
            <Toast message={toast.message} type={toast.type} onDismiss={() => setToast({ message: '', type: '' })} />
            
            {/* File Upload Section */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4">Cargar Registros de Llamadas</h2>
                <div className="bg-white p-6 rounded-lg shadow">                    <p className="text-gray-600 mb-4">
                        Sube un archivo Excel con los registros de llamadas:
                        <br />
                        Columna A: ID del llamado
                        <br />
                        Columna B: Fecha del llamado
                        <br />
                        Columna C: Nombre del Beneficiario
                        <br />
                        Columna D: Comuna del Beneficiario
                        <br />
                        Columna E: Tipo (entrante/saliente)
                        <br />
                        Columna F: Teléfono del beneficiario
                        <br />
                        Columna G: Hora inicio
                        <br />
                        Columna H: Hora fin
                        <br />
                        Columna I: Segundos hablados
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

            {/* Filters Section */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4">Filtros</h2>
                <div className="bg-white p-6 rounded-lg shadow grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Teleoperadora
                        </label>
                        <select
                            value={selectedOperadora}
                            onChange={(e) => setSelectedOperadora(e.target.value)}
                            className="w-full p-2 border rounded-md"
                        >
                            <option value="">Todas</option>
                            {operadoras.map(op => (
                                <option key={op.id} value={op.id}>{op.nombre}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Fecha Inicio
                        </label>
                        <input
                            type="date"
                            value={selectedDateRange.start}
                            onChange={(e) => setSelectedDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className="w-full p-2 border rounded-md"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Fecha Fin
                        </label>
                        <input
                            type="date"
                            value={selectedDateRange.end}
                            onChange={(e) => setSelectedDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className="w-full p-2 border rounded-md"
                        />
                    </div>
                </div>
            </div>

            {/* Statistics Section */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4">Estadísticas</h2>                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="text-lg font-semibold text-gray-600">Total Llamadas</h3>
                        <p className="text-3xl font-bold">{stats.totalCalls}</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="text-lg font-semibold text-gray-600">Entrantes</h3>
                        <p className="text-3xl font-bold text-blue-600">{stats.incomingCalls}</p>
                        <p className="text-sm text-gray-500">
                            {stats.totalCalls ? Math.round((stats.incomingCalls / stats.totalCalls) * 100) : 0}% del total
                        </p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="text-lg font-semibold text-gray-600">Salientes</h3>
                        <p className="text-3xl font-bold text-purple-600">{stats.outgoingCalls}</p>
                        <p className="text-sm text-gray-500">
                            {stats.totalCalls ? Math.round((stats.outgoingCalls / stats.totalCalls) * 100) : 0}% del total
                        </p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="text-lg font-semibold text-gray-600">Duración Total</h3>
                        <p className="text-3xl font-bold">{Math.round(stats.totalDuration / 60)} min</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="text-lg font-semibold text-gray-600">Duración Promedio</h3>
                        <p className="text-3xl font-bold">{stats.averageDuration} seg</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="text-lg font-semibold text-gray-600">Beneficiarios</h3>
                        <p className="text-3xl font-bold text-green-600">{stats.uniqueBeneficiaries}</p>
                    </div>
                </div>
            </div>

            {/* Chart Section */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4">Tendencias</h2>
                <div className="bg-white p-6 rounded-lg shadow">                    <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={timeData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" />
                            <YAxis yAxisId="left" />
                            <YAxis yAxisId="right" orientation="right" />
                            <Tooltip />
                            <Legend />
                            <Line 
                                yAxisId="left"
                                type="monotone" 
                                dataKey="entrantes" 
                                name="Llamadas Entrantes"
                                stroke="#3b82f6" 
                            />
                            <Line 
                                yAxisId="left"
                                type="monotone" 
                                dataKey="salientes" 
                                name="Llamadas Salientes"
                                stroke="#8b5cf6" 
                            />
                            <Line 
                                yAxisId="right"
                                type="monotone" 
                                dataKey="totalDuration" 
                                name="Duración Total (min)"
                                stroke="#10b981" 
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Detailed Call List */}
            <div>
                <h2 className="text-xl font-bold mb-4">Registro de Llamadas</h2>
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha/Hora</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beneficiario</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Comuna</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Teléfono</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duración</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {llamados
                                .filter(call => {
                                    if (selectedDateRange.start && call.fecha < new Date(selectedDateRange.start)) return false;
                                    if (selectedDateRange.end) {
                                        const endDate = new Date(selectedDateRange.end);
                                        endDate.setHours(23, 59, 59);
                                        if (call.fecha > endDate) return false;
                                    }
                                    return true;
                                })
                                .sort((a, b) => b.fecha - a.fecha)
                                .slice(0, 50) // Show only last 50 calls
                                .map(call => (
                                    <tr key={call.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {call.idLlamado}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {new Date(call.fecha).toLocaleDateString()} {call.horaInicio}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {call.beneficiarioNombre}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {call.comuna}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                                call.tipo === 'entrante' 
                                                    ? 'bg-blue-100 text-blue-800' 
                                                    : 'bg-purple-100 text-purple-800'
                                            }`}>
                                                {call.tipo}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {call.telefono}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {call.segundos} seg
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

export default CallDataAnalyzer;
