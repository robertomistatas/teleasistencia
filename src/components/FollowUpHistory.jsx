import React, { useState, useContext, useMemo } from 'react';
import { DataContext } from '../App';
import { ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { normalizeName } from '../utils/textUtils';
import { getTeleoperadora } from '../utils/operadoraUtils';

const STATUS = {
    OK: 'ok',            // Al día con al menos 1 llamada exitosa en los últimos 15 días
    WARNING: 'warning',  // Tiene llamadas pero no exitosas en los últimos 15 días
    DANGER: 'danger'    // Sin llamadas o sin llamadas exitosas en los últimos 30 días
};

// Función para calcular el estado de un beneficiario
const getBeneficiaryStatus = (llamadas) => {
    if (!llamadas || llamadas.length === 0) return STATUS.DANGER;

    const now = new Date();
    const llamadasOrdenadas = [...llamadas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const ultimaLlamada = llamadasOrdenadas[0];
    const diasDesdeUltimaLlamada = Math.floor((now - new Date(ultimaLlamada.fecha)) / (1000 * 60 * 60 * 24));

    // Buscar la última llamada exitosa
    const ultimaLlamadaExitosa = llamadasOrdenadas.find(llamada => 
        llamada.resultado?.toLowerCase().includes('exitoso')
    );

    if (ultimaLlamadaExitosa) {
        const diasDesdeUltimaExitosa = Math.floor((now - new Date(ultimaLlamadaExitosa.fecha)) / (1000 * 60 * 60 * 24));
        if (diasDesdeUltimaExitosa <= 15) {
            return STATUS.OK;
        }
    }

    if (diasDesdeUltimaLlamada > 30) {
        return STATUS.DANGER;
    }

    return STATUS.WARNING;
};

// Función para obtener el número de llamadas exitosas en el mes actual
const getLlamadasExitosasDelMes = (llamadas) => {
    if (!llamadas || !Array.isArray(llamadas)) return 0;
    
    const now = new Date();
    const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1);
    
    return llamadas.filter(llamada => {
        const fechaLlamada = new Date(llamada.fecha);
        return fechaLlamada >= primerDiaMes && 
               fechaLlamada <= now && 
               llamada.resultado?.toLowerCase().includes('exitoso');
    }).length;
};

// Tarjeta de beneficiario
const BeneficiaryCard = ({ 
    beneficiary = 'Sin nombre', 
    status = STATUS.DANGER, 
    comuna = 'Sin comuna registrada', 
    llamadasExitosas = [], 
    totalLlamadas = 0, 
    llamadasExitosasDelMes = 0,
    ultimaLlamada
}) => {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-4">
            <div className="flex justify-between items-start">
                <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {beneficiary}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {comuna}
                    </p>
                </div>
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                    status === STATUS.OK ? 'bg-green-100 text-green-800' :
                    status === STATUS.WARNING ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                }`}>
                    {status === STATUS.OK ? 'Al día' : status === STATUS.WARNING ? 'Pendiente' : 'Urgente'}
                </span>
            </div>
            <div className="space-y-2">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                    Total llamadas: {totalLlamadas}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                    Llamadas exitosas este mes: {llamadasExitosasDelMes}
                </p>
                {ultimaLlamada && (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Última llamada: {ultimaLlamada}
                    </p>
                )}
                {llamadasExitosas && llamadasExitosas.length > 0 && (
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Últimas llamadas exitosas:
                        </p>
                        {llamadasExitosas.slice(-3).reverse().map((fecha, index) => (
                            <div key={`${fecha}-${index}`} className="text-xs text-gray-500 dark:text-gray-400">
                                {fecha}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

function FollowUpHistory() {
    const { callData, assignments } = useContext(DataContext);
    const [activeFilter, setActiveFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedComuna, setSelectedComuna] = useState('all');

    // Procesar datos de beneficiarios
    const beneficiaryData = useMemo(() => {
        if (!callData?.llamadasPorBeneficiario) {
            console.log('No hay datos de beneficiarios');
            return [];
        }

        return Object.entries(callData.llamadasPorBeneficiario).map(([beneficiario, datos]) => {
            const llamadas = datos.llamadas || [];
            const status = getBeneficiaryStatus(llamadas);
            const comuna = llamadas[0]?.comuna || 'Sin comuna';
            const llamadasExitosas = llamadas.filter(ll => ll.resultado?.toLowerCase().includes('exitoso'));
            const ultimaLlamada = llamadas.length > 0 
                ? new Date(Math.max(...llamadas.map(ll => new Date(ll.fecha)))).toLocaleDateString()
                : null;

            return {
                beneficiario,
                status,
                comuna,
                llamadasExitosas: llamadasExitosas.map(ll => new Date(ll.fecha).toLocaleDateString()),
                totalLlamadas: llamadas.length,
                llamadasExitosasDelMes: getLlamadasExitosasDelMes(llamadas),
                ultimaLlamada
            };
        });
    }, [callData?.llamadasPorBeneficiario]);

    // Filtrar beneficiarios
    const filteredBeneficiaries = useMemo(() => {
        return beneficiaryData.filter(b => {
            const matchesSearch = b.beneficiario.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesComuna = selectedComuna === 'all' || b.comuna === selectedComuna;
            const matchesFilter = activeFilter === 'all' || 
                                (activeFilter === 'uptodate' && b.status === STATUS.OK) ||
                                (activeFilter === 'urgent' && b.status === STATUS.DANGER) ||
                                (activeFilter === 'warning' && b.status === STATUS.WARNING);
            
            return matchesSearch && matchesComuna && matchesFilter;
        });
    }, [beneficiaryData, searchTerm, selectedComuna, activeFilter]);

    // Obtener comunas únicas
    const comunas = useMemo(() => {
        const uniqueComunas = new Set(beneficiaryData.map(b => b.comuna));
        return Array.from(uniqueComunas).sort();
    }, [beneficiaryData]);

    // Contar beneficiarios por estado
    const counts = useMemo(() => ({
        total: beneficiaryData.length,
        uptodate: beneficiaryData.filter(b => b.status === STATUS.OK).length,
        urgentes: beneficiaryData.filter(b => b.status === STATUS.DANGER).length,
        pendientes: beneficiaryData.filter(b => b.status === STATUS.WARNING).length
    }), [beneficiaryData]);

    const StatusCounter = ({ label, count, className }) => (
        <div className={`flex flex-col items-center p-4 rounded-lg shadow-md ${className}`}>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{label}</span>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">{count}</span>
        </div>
    );

    return (
        <div className="p-6 space-y-6">
            {/* Filtros */}
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                <div className="flex items-center gap-2">
                    <FunnelIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filtros:</span>
                </div>
                
                {/* Selector de Comuna */}
                <div className="flex-1">
                    <select
                        value={selectedComuna}
                        onChange={(e) => setSelectedComuna(e.target.value)}
                        className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                    >
                        {comunas.map(comuna => (
                            <option key={comuna} value={comuna}>
                                {comuna === 'todas' ? 'Todas las comunas' : comuna}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Selector de Estado */}
                <div className="flex-1">
                    <select
                        value={activeFilter}
                        onChange={(e) => setActiveFilter(e.target.value)}
                        className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                    >
                        <option value="all">Todos los estados</option>
                        <option value={STATUS.OK}>Al día</option>
                        <option value={STATUS.WARNING}>Atención</option>
                        <option value={STATUS.DANGER}>Urgentes</option>
                    </select>
                </div>

                {/* Buscador */}
                <div className="flex-1">
                    <input
                        type="text"
                        placeholder="Buscar beneficiario..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                    />
                </div>
            </div>

            {/* Contadores */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatusCounter
                    label="Todos"
                    count={counts.total}
                    className="bg-gray-100 dark:bg-gray-700"
                />
                <StatusCounter
                    label="Al día"
                    count={counts.uptodate}
                    className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100"
                />
                <StatusCounter
                    label="Urgentes"
                    count={counts.urgentes}
                    className="bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100"
                />
                <StatusCounter
                    label="Pendientes"
                    count={counts.pendientes}
                    className="bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-100"
                />
            </div>

            {/* Lista de Beneficiarios */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredBeneficiaries.map((b, index) => (
                    <BeneficiaryCard
                        key={`${b.beneficiario}-${index}`}
                        beneficiary={b.beneficiario}
                        status={b.status}
                        comuna={b.comuna}
                        llamadasExitosas={b.llamadasExitosas}
                        totalLlamadas={b.totalLlamadas}
                        llamadasExitosasDelMes={b.llamadasExitosasDelMes}
                        ultimaLlamada={b.ultimaLlamada}
                    />
                ))}
            </div>
        </div>
    );
}

export default FollowUpHistory;
