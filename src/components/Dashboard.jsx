import React, { useContext, useState, useEffect } from 'react';
import { DataContext, db } from '../App';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const StatCard = ({ title, value, subtitle, icon: Icon }) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6 transition-colors duration-200">
        <div className="flex items-center">
            {Icon && <Icon className="h-8 w-8 text-blue-500 dark:text-blue-400 mr-3" />}
            <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{title}</p>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{value}</h3>
                {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
            </div>
        </div>
    </div>
);

const Dashboard = () => {
    const { callData, assignments } = useContext(DataContext);

    const totalBeneficiarios = assignments?.beneficiarios?.length || 0;
    const tiempoPromedioLlamada = callData.stats?.totalLlamados > 0 
        ? Math.round((callData.stats.duracionTotal / callData.stats.totalLlamados) * 10) / 10 
        : 0;

    // Asegurarse de que todas las operadoras asignadas aparezcan en la tabla
    assignments?.operadoras?.forEach(op => {
        const exists = rendimientoData.find(d => d.name === op.nombre);
        if (!exists) {
            rendimientoData.push({
                name: op.nombre,
                llamados: 0,
                minutos: 0,
                tiempoPromedio: 0
            });
        }
    });

    // Calcular métricas
    const beneficiariosAtendidos = callData.stats?.beneficiarios.size || 0;
    const porcentajeCobertura = totalBeneficiarios > 0 
        ? Math.round((beneficiariosAtendidos / totalBeneficiarios) * 100)
        : 0;    // Preparar datos para visualización
    const rendimientoData = Object.entries(callData.stats?.teleoperadoras || {}).map(([operadora, datos]) => ({
        name: operadora,
        llamados: datos.llamados,
        minutos: datos.minutos,
        tiempoPromedio: datos.llamados > 0 ? Math.round((datos.minutos / datos.llamados) * 10) / 10 : 0,
        porcentajeTotal: Math.round((datos.llamados / callData.stats.totalLlamados) * 100) || 0
    }));

    // Asegurar que filters siempre tenga un valor predeterminado
    const defaultFilters = {
        fechaInicio: '',
        fechaFin: '',
        operadora: '',
        comuna: '',
        tipo: '',
    };
    const [filters, setFilters] = useState(defaultFilters);

    // Validar que filters esté definido antes de usarlo
    if (!filters) {
        console.error('El estado filters no está definido.');
        return <div>Error: Filtros no están disponibles.</div>;
    }

    return (
        <div className="space-y-6 p-6 dark:bg-gray-900">
            <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard de Análisis</h2>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                    Última actualización: {new Date().toLocaleString()}
                </div>
            </div>            {/* Métricas principales */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard
                    title="Total de Llamados"
                    value={callData.stats?.totalLlamados || 0}
                    subtitle="Llamadas registradas"
                />
                <StatCard
                    title="Tiempo Total (min)"
                    value={callData.stats?.duracionTotal || 0}
                    subtitle={`Promedio: ${tiempoPromedioLlamada} min/llamada`}
                />
                <StatCard
                    title="Cobertura"
                    value={`${Math.round((callData.stats?.beneficiarios.size / totalBeneficiarios) * 100) || 0}%`}
                    subtitle={`${callData.stats?.beneficiarios.size || 0} de ${totalBeneficiarios} beneficiarios`}
                />
                <StatCard
                    title="Operadoras Activas"
                    value={Object.keys(callData.stats?.teleoperadoras || {}).length || 0}
                    subtitle="Teleoperadoras en servicio"
                />
            </div>

            {/* Filtros con diseño mejorado */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md space-y-4">
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">Filtros</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-600">Fecha Inicio</label>
                        <input
                            type="date"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={filters.fechaInicio}
                            onChange={(e) => setFilters({...filters, fechaInicio: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-600">Fecha Fin</label>
                        <input
                            type="date"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={filters.fechaFin}
                            onChange={(e) => setFilters({...filters, fechaFin: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-600">Operadora</label>
                        <select
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={filters.operadora}
                            onChange={(e) => setFilters({...filters, operadora: e.target.value})}
                        >
                            <option>Todas las operadoras</option>
                            {assignments?.operadoras?.map(op => (
                                <option key={op.id}>{op.nombre}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-600">Comuna</label>
                        <select
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={filters.comuna}
                            onChange={(e) => setFilters({...filters, comuna: e.target.value})}
                        >
                            <option>Todas las comunas</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-600">Tipo</label>
                        <select
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={filters.tipo}
                            onChange={(e) => setFilters({...filters, tipo: e.target.value})}
                        >
                            <option>Todos los tipos</option>
                            <option>Entrante</option>
                            <option>Saliente</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Métricas principales con diseño mejorado */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard
                    title="Total Llamados"
                    value={callData.totalLlamados || 0}
                    subtitle="Llamadas registradas"
                />
                <StatCard
                    title="Tiempo Total"
                    value={`${callData.tiempoTotal || 0} min`}
                    subtitle={`${tiempoPromedioLlamada} min/llamada`}
                />
                <StatCard
                    title="Cobertura"
                    value={`${porcentajeCobertura}%`}
                    subtitle={`${beneficiariosAtendidos} de ${totalBeneficiarios} beneficiarios`}
                />
                <StatCard
                    title="Operadoras Activas"
                    value={assignments?.operadoras?.length || 0}
                    subtitle="Teleoperadoras registradas"
                />
            </div>

            {/* Gráfico de Llamados por Teleoperadora */}
            <div className="mt-8">
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">Rendimiento por Teleoperadora</h3>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6">
                    <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={rendimientoData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" stroke="#374151" />
                            <YAxis stroke="#374151" />
                            <Tooltip 
                                contentStyle={{ 
                                    backgroundColor: '#1f2937',
                                    border: 'none',
                                    borderRadius: '0.5rem',
                                    color: '#f3f4f6'
                                }}
                            />
                            <Legend />
                            <Bar dataKey="llamados" fill="#3b82f6" name="Llamados" />
                            <Bar dataKey="minutos" fill="#10b981" name="Minutos" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="mt-8">
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">Detalle por Teleoperadora</h3>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Operadora</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Llamados</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Minutos Totales</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Tiempo Promedio</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">% del Total</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {rendimientoData.map((operadora, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">{operadora.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">{operadora.llamados}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">{operadora.minutos}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">{operadora.tiempoPromedio}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">{operadora.porcentajeTotal}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
