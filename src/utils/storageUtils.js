import { normalizeName } from './textUtils';
import { getTeleoperadora } from './operadoraUtils';

/**
 * Prepara las estadísticas para ser almacenadas, convirtiendo estructuras como Set y Map a formato serializable
 * @param {Object} stats - Objeto de estadísticas a serializar
 * @param {Function} getTeleoperadoraFn - Función para obtener la teleoperadora de un beneficiario
 * @returns {Object} Estadísticas en formato serializable
 */
export const prepareStatsForStorage = (stats, assignments) => {
    if (!stats) return null;

    try {
        return {
            totalLlamadas: stats.totalLlamadas || 0,
            entrantes: stats.entrantes || 0,
            salientes: stats.salientes || 0,
            duracionTotal: stats.duracionTotal || 0,
            duracionPromedio: stats.duracionPromedio || 0,
            
            // Convertir Sets a arrays
            beneficiarios: Array.from(stats.beneficiarios || []),
            beneficiariosAlDia: Array.from(stats.beneficiariosAlDia || []),
            beneficiariosPendientes: Array.from(stats.beneficiariosPendientes || []),
            beneficiariosUrgentes: Array.from(stats.beneficiariosUrgentes || []),
            
            // Convertir Map de comunas a objeto
            comunas: Object.fromEntries(
                Array.from(stats.comunas || []).map(([comuna, beneficiarios]) => [
                    comuna,
                    Array.from(beneficiarios || [])
                ])
            ),
            
            // Procesar llamadas por beneficiario
            llamadasPorBeneficiario: Object.entries(stats.llamadasPorBeneficiario || {}).reduce((acc, [beneficiario, llamadas]) => {
                acc[beneficiario] = {
                    total: Array.isArray(llamadas) ? llamadas.length : 0,
                    operadora: getTeleoperadora(null, beneficiario, assignments),
                    estado: stats.beneficiariosAlDia?.has(beneficiario) 
                        ? 'al-dia' 
                        : stats.beneficiariosUrgentes?.has(beneficiario)
                            ? 'urgente'
                            : 'pendiente',
                    llamadas: Array.isArray(llamadas) ? llamadas.map(llamada => ({
                        ...llamada,
                        fecha: (llamada.fecha instanceof Date && !isNaN(llamada.fecha)) ? llamada.fecha.toISOString() : (typeof llamada.fecha === 'string' ? llamada.fecha : null)
                    })) : []
                };
                return acc;
            }, {}),
            
            // Convertir fechas en últimas llamadas
            ultimasLlamadas: Object.entries(stats.ultimasLlamadas || {}).reduce((acc, [beneficiario, llamada]) => {
                if (llamada) {
                    acc[beneficiario] = {
                        ...llamada,
                        fecha: (llamada.fecha instanceof Date && !isNaN(llamada.fecha)) ? llamada.fecha.toISOString() : (typeof llamada.fecha === 'string' ? llamada.fecha : null)
                    };
                }
                return acc;
            }, {}),
            
            // Convertir llamadas exitosas
            llamadasExitosas: Object.entries(stats.llamadasExitosas || {}).reduce((acc, [beneficiario, llamadas]) => {
                if (Array.isArray(llamadas)) {
                    acc[beneficiario] = llamadas.map(llamada => ({
                        ...llamada,
                        fecha: (llamada.fecha instanceof Date && !isNaN(llamada.fecha)) ? llamada.fecha.toISOString() : (typeof llamada.fecha === 'string' ? llamada.fecha : null)
                    }));
                }
                return acc;
            }, {}),

            // Convertir datos de teleoperadoras
            teleoperadoras: Object.entries(stats.teleoperadoras || {}).reduce((acc, [operadora, datos]) => {
                acc[operadora] = {
                    total: datos.total || 0,
                    exitosas: datos.exitosas || 0,
                    beneficiarios: Array.from(datos.beneficiarios || [])
                };
                return acc;
            }, {})
        };
    } catch (error) {
        console.error('Error preparing stats for storage:', error);
        return null;
    }
};
