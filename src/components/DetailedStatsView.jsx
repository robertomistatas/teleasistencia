import React from 'react';
import BarChart from './charts/BarChart';

const DetailedStatsView = ({ stats, operatorStats }) => {
    // Métricas por comuna
    const comunasData = Object.entries(stats.comunas || {}).map(([comuna, beneficiarios]) => ({
        comuna,
        cantidad: Array.isArray(beneficiarios) ? beneficiarios.length : 0
    })).sort((a, b) => b.cantidad - a.cantidad);

    // Datos de operadoras
    const operadorasData = Object.entries(operatorStats || {}).map(([operadora, data]) => ({
        operadora,
        totalLlamadas: data.totalLlamadas || 0,
        beneficiarios: data.beneficiarios || 0,
        promedioLlamadas: ((data.totalLlamadas || 0) / 30).toFixed(1),
        duracionPromedio: data.duracionTotal && data.totalLlamadas ? 
            Math.round(data.duracionTotal / data.totalLlamadas) : 0
    })).sort((a, b) => b.totalLlamadas - a.totalLlamadas);

    // Datos para el gráfico
    const chartData = {
        labels: ['8:00', '9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'],
        datasets: [{
            label: 'Cantidad de Llamadas',
            data: [10, 15, 20, 25, 30, 25, 20, 15, 10, 5],
            backgroundColor: 'rgba(53, 162, 235, 0.5)',
        }]
    };

    return (
        <div className="space-y-8">
            {/* Datos por Teleoperadora */}
            {operadorasData.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                    <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
                        Métricas por Teleoperadora
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Teleoperadora
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Total Llamadas
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Beneficiarios
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Promedio Diario
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Duración Promedio
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {operadorasData.map(({ operadora, totalLlamadas, beneficiarios, promedioLlamadas, duracionPromedio }) => (
                                    <tr key={operadora}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                            {operadora}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {totalLlamadas}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {beneficiarios}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {promedioLlamadas}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {duracionPromedio} min
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Gráfico */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
                    Distribución Horaria de Llamadas
                </h3>
                <div className="h-[400px]">
                    <BarChart data={chartData} />
                </div>
            </div>

            {/* Datos por Comuna */}
            {comunasData.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                    <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
                        Distribución por Comuna
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Comuna
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Beneficiarios
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {comunasData.map(({ comuna, cantidad }) => (
                                    <tr key={comuna}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                            {comuna}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {cantidad}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DetailedStatsView;
