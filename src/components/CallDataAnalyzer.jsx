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
                const workbook = read(data, { 
                    type: 'array', 
                    cellDates: true,
                    dateNF: 'dd/mm/yyyy',
                    raw: false
                });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = utils.sheet_to_json(worksheet, { 
                    raw: false,
                    dateNF: 'dd/mm/yyyy',
                    defval: ''  // Valor por defecto para celdas vacías
                });

                // Process each call record
                for (const row of json) {
                    console.log("Processing row:", row);
                    const rawDate = row['B'];
                    
                    // Validar que la fecha no esté vacía
                    if (!rawDate) {
                        console.error("Fecha vacía en la fila:", row);
                        throw new Error(`Falta la fecha en la fila con ID: ${row['A'] || 'desconocido'}`);
                    }

                    let fecha;
                    
                    try {
                        // Si es una fecha de Excel (número)
                        if (typeof rawDate === 'number') {
                            // Excel stores dates as number of days since January 1, 1900
                            const utc_days = Math.floor(rawDate - 25569);
                            const utc_value = utc_days * 86400;
                            fecha = new Date(utc_value * 1000);
                        }
                        // Si es un string en formato DD/MM/YYYY
                        else if (typeof rawDate === 'string') {
                            const parts = rawDate.split('/');
                            if (parts.length === 3) {
                                const day = parseInt(parts[0], 10);
                                const month = parseInt(parts[1], 10) - 1;
                                let year = parseInt(parts[2], 10);
                                
                                // Ajustar año si es necesario
                                if (year < 100) {
                                    year += year < 50 ? 2000 : 1900;
                                }

                                if (isNaN(day) || isNaN(month) || isNaN(year)) {
                                    throw new Error(`Formato de fecha inválido: ${rawDate}`);
                                }

                                if (day < 1 || day > 31 || month < 0 || month > 11 || year < 2000 || year > 2100) {
                                    throw new Error(`Valores de fecha fuera de rango: ${rawDate}`);
                                }

                                fecha = new Date(year, month, day);
                            } else {
                                // Intentar parsear como fecha ISO
                                fecha = new Date(rawDate);
                            }
                        }
                        // Si ya es un objeto Date
                        else if (rawDate instanceof Date) {
                            fecha = rawDate;
                        }
                        else {
                            throw new Error(`Formato de fecha no reconocido: ${rawDate}`);
                        }

                        // Validar que la fecha sea válida
                        if (isNaN(fecha.getTime())) {
                            throw new Error(`Fecha inválida: ${rawDate}`);
                        }

                        // Validar que la fecha no esté en el futuro
                        const now = new Date();
                        if (fecha > now) {
                            throw new Error(`La fecha ${rawDate} está en el futuro`);
                        }

                    } catch (error) {
                        console.error("Error parsing date:", rawDate, error);
                        throw new Error(`Error en el formato de fecha: ${rawDate}. La fecha debe estar en formato DD/MM/YYYY`);
                    }

                    // Parse time values
                    const parseExcelTime = (timeValue) => {
                        if (!timeValue) return null;
                        
                        try {
                            // Limpiar el valor de entrada
                            const cleanTime = String(timeValue).trim();
                            
                            // Probar primero el formato HH:mm
                            const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
                            if (timeRegex.test(cleanTime)) {
                                return cleanTime.padStart(5, '0'); // Asegurar formato HH:mm
                            }

                            // Probar formato numérico de Excel
                            const numericTime = parseFloat(cleanTime);
                            if (!isNaN(numericTime)) {
                                if (numericTime >= 0 && numericTime < 1) {
                                    // Formato de Excel (fracción de día)
                                    const totalMinutes = Math.round(numericTime * 24 * 60);
                                    const hours = Math.floor(totalMinutes / 60);
                                    const minutes = totalMinutes % 60;
                                    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                                } else if (numericTime >= 1 && numericTime <= 2359) {
                                    // Formato militar (HHMM)
                                    const hours = Math.floor(numericTime / 100);
                                    const minutes = numericTime % 100;
                                    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                                        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                                    }
                                }
                            }
                            
                            // Intentar otros formatos comunes
                            const formats = [
                                /^(\d{1,2})[:](\d{2})$/, // HH:mm o H:mm
                                /^(\d{1,2})[.](\d{2})$/, // HH.mm o H.mm
                                /^(\d{4})$/ // HHMM
                            ];

                            for (const format of formats) {
                                const match = cleanTime.match(format);
                                if (match) {
                                    let hours = parseInt(match[1], 10);
                                    let minutes = parseInt(match[2] || cleanTime.slice(-2), 10);
                                    
                                    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                                        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                                    }
                                }
                            }
                            
                            console.warn("Formato de hora no válido:", timeValue);
                            return null;
                        } catch (error) {
                            console.error("Error al procesar la hora:", timeValue, error);
                            return null;
                        }
                    };

                    const horaInicio = parseExcelTime(row['G']);
                    const horaFin = parseExcelTime(row['H']);

                    if (!horaInicio || !horaFin) {
                        throw new Error(`Hora inválida en la fila con ID ${row['A']}: Inicio=${row['G']}, Fin=${row['H']}`);
                    }

                    // Validate required fields
                    if (!row['A'] || !fecha || !row['C'] || !row['E']) {
                        throw new Error(`Faltan campos requeridos en la fila: ${JSON.stringify(row)}`);
                    }

                    // Normalize the tipo value
                    const tipo = String(row['E'] || '').toLowerCase().trim();
                    if (tipo !== 'entrante' && tipo !== 'saliente') {
                        throw new Error(`Tipo de llamada inválido: ${row['E']}. Debe ser 'entrante' o 'saliente'`);
                    }

                    // Validate segundos
                    const segundos = parseInt(row['I']);
                    if (isNaN(segundos) || segundos < 0) {
                        throw new Error(`Duración inválida: ${row['I']}. Debe ser un número positivo`);
                    }

                    const callRecord = {
                        idLlamado: String(row['A']).trim(),
                        fecha: fecha,
                        beneficiarioNombre: String(row['C']).trim(),
                        comuna: String(row['D'] || '').trim(),
                        tipo: tipo,
                        telefono: String(row['F'] || '').trim(),
                        horaInicio: horaInicio,
                        horaFin: horaFin,
                        segundos: segundos
                    };

                    // Create new call record
                    const callRef = doc(collection(db, 'llamados'));
                    await setDoc(callRef, callRecord);
                }

                // Refresh call logs
                const llamadosSnap = await getDocs(collection(db, 'llamados'));
                setLlamados(llamadosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                setToast({ message: 'Registros de llamadas cargados con éxito', type: 'success' });
            } catch (error) {
                console.error("Error processing file:", error);
                console.error("Error details:", error);                setToast({ 
                    message: `Error al procesar archivo: ${error.message}. Las fechas deben estar en formato DD/MM/YYYY y las horas en formato HH:MM.`, 
                    type: 'error' 
                });
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

    // Calculate statistics
    const getCallStats = () => {
        let filteredCalls = llamados;

        if (selectedDateRange.start) {
            const startDate = new Date(selectedDateRange.start);
            filteredCalls = filteredCalls.filter(call => {
                const callDate = call.fecha instanceof Date ? call.fecha : new Date(call.fecha);
                return callDate >= startDate;
            });
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
