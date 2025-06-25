import React, { useMemo, Suspense } from 'react';
import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import BarChart from './charts/BarChart';

const DetailedStatsView = ({ stats, operatorStats }) => {
    // Validación de props y manejo de errores
    if (!stats) {
        return (
            <div className="p-6 text-center">
                <p className="text-gray-500">Cargando estadísticas...</p>
            </div>
        );
    }

    // Verificar estructura de datos necesaria
    if (!stats.comunas || !stats.horasPico) {
        return (
            <div className="p-6 text-center">
                <p className="text-gray-500">No hay datos suficientes para mostrar estadísticas detalladas</p>
            </div>
        );
    }

    // Procesamiento de datos por comuna con manejo de errores
    const comunasData = useMemo(() => {
        if (!stats || !stats.comunas) return [];
        try {
            return Array.from(stats.comunas.entries())
                .map(([comuna, cantidad]) => ({
                    comuna,
                    cantidad,
                    porcentaje: ((cantidad / stats.totalLlamadas) * 100).toFixed(1)
                }))
                .sort((a, b) => b.cantidad - a.cantidad);
        } catch (error) {
            console.error('Error procesando datos de comunas:', error);
            return [];
        }
    }, [stats.comunas, stats.totalLlamadas]);

    // Procesamiento de datos por hora
    const horasPicoData = useMemo(() => {
        const labels = Array.from(stats.horasPico.keys()).sort();
        return {
            labels,
            datasets: [
                {
                    label: 'Cantidad de Llamadas',
                    data: labels.map(hora => stats.horasPico.get(hora)),
                    backgroundColor: 'rgba(53, 162, 235, 0.5)',
                }
            ]
        };
    }, [stats.horasPico]);

    // Procesamiento de datos por operadora
    const operadorasData = useMemo(() => {
        if (!operatorStats) return [];
        
        return Object.entries(operatorStats)
            .map(([operadora, data]) => ({
                operadora,
                ...data,
                promedioLlamadas: (data.totalLlamadas / data.diasTrabajados).toFixed(1),
                duracionPromedio: Math.round(data.duracionTotal / data.totalLlamadas)
            }))
            .sort((a, b) => b.totalLlamadas - a.totalLlamadas);
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
                                        {data.duracionPromedio} seg
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {data.entrantes}/{data.salientes}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Gráfico de Horas Pico */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Distribución por Hora</h3>
                <div className="h-64">
                    <Suspense fallback={<div>Cargando gráfico...</div>}>
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
