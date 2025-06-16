import React, { useMemo, Suspense } from 'react';
import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import BarChart from './charts/BarChart';

const DetailedStatsView = ({ stats, operatorStats }) => {
    // Procesamiento de datos por comuna
    const comunasData = useMemo(() => {
        const data = Array.from(stats.comunas.entries())
            .map(([comuna, cantidad]) => ({
                comuna,
                cantidad,
                porcentaje: ((cantidad / stats.totalLlamadas) * 100).toFixed(1)
            }))
            .sort((a, b) => b.cantidad - a.cantidad);

        return data;
    }, [stats.comunas, stats.totalLlamadas]);

    // Procesamiento de datos por hora
    const horasPicoData = useMemo(() => {
        const labels = Array.from(stats.horasPico.keys()).sort();
        const data = {
            labels,
            datasets: [
                {
                    label: 'Cantidad de Llamadas',
                    data: labels.map(hora => stats.horasPico.get(hora)),
                    backgroundColor: 'rgba(53, 162, 235, 0.5)',
                }
            ]
        };
        return data;
    }, [stats.horasPico]);

    // Procesamiento de datos por operadora
    const operadorasData = useMemo(() => {
        if (!operatorStats) return [];
        
        return Object.entries(operatorStats).map(([operadora, data]) => ({
            operadora,
            ...data,
            promedioLlamadas: (data.totalLlamadas / data.diasTrabajados).toFixed(1),
            duracionPromedio: Math.round(data.duracionTotal / data.totalLlamadas)
        })).sort((a, b) => b.totalLlamadas - a.totalLlamadas);
    }, [operatorStats]);

    return (
        <div className="space-y-8">
            {/* Datos por Teleoperadora */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Métricas por Teleoperadora</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Teleoperadora
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Total Llamadas
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Promedio Diario
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Duración Promedio
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Entrantes/Salientes
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {operadorasData.map((data, idx) => (
                                <tr key={data.operadora} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {data.operadora}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {data.totalLlamadas}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {data.promedioLlamadas}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {data.duracionPromedio}s
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <div className="flex items-center space-x-2">
                                            <ArrowDownIcon className="h-4 w-4 text-green-500" />
                                            <span>{data.entrantes}</span>
                                            <span className="text-gray-400">/</span>
                                            <ArrowUpIcon className="h-4 w-4 text-blue-500" />
                                            <span>{data.salientes}</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Gráfico de Horas Pico */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Distribución Horaria de Llamadas</h3>                <div className="h-64">
                    <Suspense fallback={<div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>}>
                        <BarChart data={horasPicoData} />
                    </Suspense>
                </div>
            </div>

            {/* Datos por Comuna */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Distribución por Comuna</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Comuna
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Cantidad
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Porcentaje
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {comunasData.map((data, idx) => (
                                <tr key={data.comuna} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {data.comuna}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {data.cantidad}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {data.porcentaje}%
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

export default React.memo(DetailedStatsView);
