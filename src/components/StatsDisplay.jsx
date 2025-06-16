import React from 'react';

function StatsDisplay({ stats }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Total Llamadas</h3>
                <p className="text-3xl font-bold">{stats.totalLlamadas}</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Entrantes</h3>
                <p className="text-3xl font-bold">
                    {stats.entrantes}
                    <span className="text-sm text-gray-500 ml-2">
                        ({stats.totalLlamadas ? Math.round((stats.entrantes / stats.totalLlamadas) * 100) : 0}%)
                    </span>
                </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Salientes</h3>
                <p className="text-3xl font-bold">
                    {stats.salientes}
                    <span className="text-sm text-gray-500 ml-2">
                        ({stats.totalLlamadas ? Math.round((stats.salientes / stats.totalLlamadas) * 100) : 0}%)
                    </span>
                </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Duración Total</h3>
                <p className="text-3xl font-bold">{Math.floor(stats.duracionTotal / 60)} min</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Duración Promedio</h3>
                <p className="text-3xl font-bold">{Math.round(stats.duracionPromedio)} seg</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
                <h3 className="text-lg font-semibold mb-2">Beneficiarios</h3>
                <p className="text-3xl font-bold">{stats.beneficiarios.size}</p>
            </div>
        </div>
    );
}

export default React.memo(StatsDisplay);
