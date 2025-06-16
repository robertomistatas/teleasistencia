import React, { useContext, useState } from 'react';
import { DataContext } from '../App';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const StatCard = ({ title, value, subtitle, icon: Icon }) => (
    <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center">
            {Icon && <Icon className="h-8 w-8 text-blue-500 mr-3" />}
            <div>
                <p className="text-sm text-gray-600">{title}</p>
                <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
                {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
            </div>
        </div>
    </div>
);

const Dashboard = () => {
    const { callData, assignments } = useContext(DataContext);
    const [filters, setFilters] = useState({
        fechaInicio: '',
        fechaFin: '',
        operadora: 'Todas las operadoras',
        comuna: 'Todas las comunas',
        tipo: 'Todos los tipos'
    });

    // Preparar datos para los gráficos y tabla
    const rendimientoData = [];
    const totalBeneficiarios = assignments?.beneficiarios?.length || 0;
    const tiempoPromedioLlamada = callData.totalLlamados > 0 
        ? Math.round((callData.tiempoTotal / callData.totalLlamados) * 10) / 10 
        : 0;
    
    // Procesar datos de rendimiento
    Object.entries(callData.rendimientoPorOperadora || {}).forEach(([operadora, datos]) => {
        const tiempoPromedio = datos.llamados > 0 ? Math.round((datos.minutos / datos.llamados) * 10) / 10 : 0;
        rendimientoData.push({
            name: operadora,
            llamados: datos.llamados,
            minutos: datos.minutos,
            tiempoPromedio
        });
    });

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
    const beneficiariosAtendidos = callData.beneficiariosAtendidos?.size || 0;
    const porcentajeCobertura = totalBeneficiarios > 0 
        ? Math.round((beneficiariosAtendidos / totalBeneficiarios) * 100)
        : 0;

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-gray-900">Dashboard de Análisis</h2>
                <div className="text-sm text-gray-500">
                    Última actualización: {new Date().toLocaleString()}
                </div>
            </div>

            {/* Filtros con diseño mejorado */}
            <div className="bg-white p-6 rounded-xl shadow-md space-y-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Filtros</h3>
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
            <div className="bg-white p-6 rounded-xl shadow-md">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Rendimiento por Teleoperadora</h3>
                <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={rendimientoData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis yAxisId="left" orientation="left" stroke="#3b82f6" />
                            <YAxis yAxisId="right" orientation="right" stroke="#10b981" />
                            <Tooltip />
                            <Legend />
                            <Bar yAxisId="left" dataKey="llamados" fill="#3b82f6" name="Llamados" />
                            <Bar yAxisId="right" dataKey="tiempoPromedio" fill="#10b981" name="Tiempo Promedio (min)" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Tabla de Rendimiento */}
            <div className="bg-white p-6 rounded-xl shadow-md overflow-x-auto">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Detalle por Teleoperadora</h3>
                <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                        <tr>
                            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Operadora</th>
                            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Llamados</th>
                            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Minutos Totales</th>
                            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tiempo Promedio</th>
                            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">% del Total</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {rendimientoData.map((operadora, idx) => {
                            const porcentajeLlamados = callData.totalLlamados > 0 
                                ? Math.round((operadora.llamados / callData.totalLlamados) * 100) 
                                : 0;
                            
                            return (
                                <tr key={operadora.name} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{operadora.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{operadora.llamados}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{operadora.minutos}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{operadora.tiempoPromedio} min</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{porcentajeLlamados}%</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Dashboard;
