import React, { useMemo } from 'react';

const StatsDisplay = ({ stats }) => {
    // Evitar renderizado si no hay stats
    if (!stats) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow-md p-4">
                    <h3 className="text-lg font-semibold mb-2">Cargando estadísticas...</h3>
                </div>
            </div>
        );
    }

    // Validar y preparar datos seguros
    const validStats = useMemo(() => ({
        totalLlamadas: stats.totalLlamadas || 0,
        entrantes: stats.entrantes || 0,
        salientes: stats.salientes || 0,
        duracionTotal: stats.duracionTotal || 0,
        duracionPromedio: stats.duracionPromedio || 0,
        beneficiarios: stats.beneficiarios || new Set()
    }), [stats]);

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Total Llamadas</h3>                <p className="text-3xl font-bold">{validStats.totalLlamadas}</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Entrantes</h3>
                <p className="text-3xl font-bold">
                    {validStats.entrantes}
                    <span className="text-sm text-gray-500 ml-2">
                        ({validStats.totalLlamadas ? Math.round((validStats.entrantes / validStats.totalLlamadas) * 100) : 0}%)
                    </span>
                </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Salientes</h3>
                <p className="text-3xl font-bold">
                    {validStats.salientes}
                    <span className="text-sm text-gray-500 ml-2">
                        ({validStats.totalLlamadas ? Math.round((validStats.salientes / validStats.totalLlamadas) * 100) : 0}%)
                    </span>
                </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Duración Total</h3>
                <p className="text-3xl font-bold">{Math.floor(validStats.duracionTotal / 60)} min</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Duración Promedio</h3>
                <p className="text-3xl font-bold">{Math.round(validStats.duracionPromedio)} seg</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Beneficiarios</h3>
                <p className="text-3xl font-bold">{validStats.beneficiarios.size}</p>
            </div>
        </div>
    );
}

export default React.memo(StatsDisplay);
