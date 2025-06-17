import React, { useState, useEffect, useContext, useMemo } from 'react';
import { DataContext } from '../App';
import { ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

const STATUS = {
    OK: 'ok',
    WARNING: 'warning', // 15+ días
    DANGER: 'danger'    // 30+ días
};

const StatusBadge = ({ status, days }) => {    const configs = {
        [STATUS.OK]: {
            className: 'bg-gradient-to-r from-blue-400 to-blue-500 text-white shadow-blue-200',
            icon: CheckCircleIcon,
            text: 'Al día'
        },
        [STATUS.WARNING]: {
            className: 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-yellow-200',
            icon: ExclamationTriangleIcon,
            text: 'Atención'
        },
        [STATUS.DANGER]: {
            className: 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-red-200',
            icon: XCircleIcon,
            text: 'Urgente'
        }
    };

    const config = configs[status];
    const Icon = config.icon;

    return (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium shadow-lg ${config.className} transform transition-all duration-300 hover:scale-105`}>
            <Icon className="h-4 w-4" />
            <span className="font-semibold">{config.text}</span>
            <span className="ml-1 opacity-90">• {days}d</span>
        </div>
    );
};

const BeneficiaryCard = ({ beneficiary, contacts }) => {
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        try {
            const [day, month, year] = dateStr.split('-').map(num => num.trim());
            return new Date(year, month - 1, day);
        } catch (error) {
            console.error('Error parsing date:', dateStr, error);
            return null;
        }
    };

    const getDaysSince = (dateStr) => {
        if (!dateStr) return 999;
        const date = parseDate(dateStr);
        if (!date) return 999;
        return Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
    };

    // Encontrar el último contacto exitoso
    const lastSuccessfulContact = contacts
        .filter(c => c.exitoso)
        .sort((a, b) => {
            const dateA = parseDate(a.fecha);
            const dateB = parseDate(b.fecha);
            return (dateB || 0) - (dateA || 0);
        })[0]?.fecha;

    const daysSinceContact = getDaysSince(lastSuccessfulContact);

    const status = daysSinceContact >= 30 ? STATUS.DANGER :
                   daysSinceContact >= 15 ? STATUS.WARNING :
                   STATUS.OK;

    const statusClasses = {
        [STATUS.OK]: 'border-green-200 hover:border-green-300',
        [STATUS.WARNING]: 'border-yellow-200 hover:border-yellow-300',
        [STATUS.DANGER]: 'border-red-200 hover:border-red-300'
    };

    // Obtener contactos de este mes
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    
    const contactsThisMonth = contacts.filter(c => {
        const date = parseDate(c.fecha);
        return date && 
               date.getMonth() === thisMonth &&
               date.getFullYear() === thisYear;
    });

    const successfulContactsThisMonth = contactsThisMonth.filter(c => c.exitoso).length;

    return (        <div className={`bg-white rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300 ${statusClasses[status]}`}>
            <div className="p-5">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h3 className="font-semibold text-gray-800 text-xl mb-1">{beneficiary}</h3>
                        <StatusBadge status={status} days={daysSinceContact} />
                    </div>
                </div>
                
                <div className="space-y-4 mt-4">
                    <div className="flex flex-col space-y-1">
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Contactos este mes</span>
                            <div className="flex items-center space-x-2">
                                <span className="text-lg font-semibold text-gray-800">{contactsThisMonth.length}</span>                                <span className="bg-blue-50 text-blue-600 text-sm py-0.5 px-2 rounded-full font-medium">
                                    {successfulContactsThisMonth} exitosos
                                </span>
                            </div>
                        </div>
                        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                                className="h-1 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-300"
                                style={{ 
                                    width: `${contactsThisMonth.length ? 
                                        (successfulContactsThisMonth / contactsThisMonth.length) * 100 : 0}%` 
                                }}
                            />
                        </div>
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Último contacto exitoso</span>
                            <span className={`font-medium ${!lastSuccessfulContact ? 
                                'text-red-500 bg-red-50 px-2 py-1 rounded-full text-sm' : 
                                'text-gray-800'}`}>
                                {lastSuccessfulContact ? 
                                    parseDate(lastSuccessfulContact).toLocaleDateString() :
                                    'Sin contactos exitosos'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const FilterTabs = ({ activeFilter, onFilterChange, counts }) => (
    <div className="flex space-x-2 mb-6">
        <button
            onClick={() => onFilterChange('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'all' 
                    ? 'bg-gray-900 text-white' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
            Todos ({counts.all})
        </button>
        <button
            onClick={() => onFilterChange('urgent')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'urgent' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
        >
            Urgentes ({counts.urgent})
        </button>
        <button
            onClick={() => onFilterChange('warning')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'warning' 
                    ? 'bg-yellow-500 text-white' 
                    : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'}`}
        >
            Pendientes ({counts.warning})
        </button>
        <button
            onClick={() => onFilterChange('ok')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'ok' 
                    ? 'bg-green-600 text-white' 
                    : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
        >
            Al día ({counts.ok})
        </button>
    </div>
);

const SearchBar = ({ value, onChange }) => (
    <div className="relative mb-6">
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="Buscar beneficiario..."
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-150"
        />
    </div>
);

function FollowUpHistory() {
    const { callData } = useContext(DataContext);
    const [followUpData, setFollowUpData] = useState([]);
    const [activeFilter, setActiveFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Función para parsear fechas en formato DD-MM-YYYY
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        try {
            const [day, month, year] = dateStr.split('-').map(num => num.trim());
            return new Date(year, month - 1, day);
        } catch (error) {
            console.error('Error parsing date:', dateStr, error);
            return null;
        }
    };

    // Función para calcular días desde una fecha
    const getDaysSince = (dateStr) => {
        if (!dateStr) return 999;
        const date = parseDate(dateStr);
        if (!date) return 999;
        return Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
    };

    useEffect(() => {
        if (!callData?.detallesLlamadas) return;

        // Agrupar llamadas por beneficiario
        const beneficiaryContacts = callData.detallesLlamadas.reduce((acc, call) => {
            if (!acc[call.beneficiario]) {
                acc[call.beneficiario] = [];
            }
              acc[call.beneficiario].push({
                fecha: call.fecha,
                tipo: call.evento,
                duracion: call.segundos,
                resultado: call.resultado,
                exitoso: call.exitoso
            });
            return acc;
        }, {});

        // Convertir a array y ordenar por último contacto exitoso
        const followUpArray = Object.entries(beneficiaryContacts)
            .map(([beneficiary, contacts]) => {
                // Encontrar el último contacto exitoso
                const lastSuccessfulContact = contacts
                    .filter(c => c.exitoso)
                    .sort((a, b) => {
                        const dateA = parseDate(a.fecha);
                        const dateB = parseDate(b.fecha);
                        return (dateB || 0) - (dateA || 0);
                    })[0];
                
                // Ordenar todos los contactos por fecha
                const sortedContacts = contacts.sort((a, b) => {
                    const dateA = parseDate(a.fecha);
                    const dateB = parseDate(b.fecha);
                    return (dateB || 0) - (dateA || 0);
                });
                
                return {
                    beneficiary,
                    contacts: sortedContacts,
                    lastSuccessfulContact: lastSuccessfulContact?.fecha || null
                };
            })
            .sort((a, b) => {
                // Ordenar por fecha del último contacto exitoso
                const daysA = getDaysSince(a.lastSuccessfulContact);
                const daysB = getDaysSince(b.lastSuccessfulContact);
                return daysB - daysA;
            });

        console.log('Follow-up data processed:', followUpArray);
        setFollowUpData(followUpArray);
    }, [callData]);    const filteredData = useMemo(() => {
        return followUpData.filter(item => {
            // Aplicar búsqueda
            if (searchQuery && !item.beneficiary.toLowerCase().includes(searchQuery.toLowerCase())) {
                return false;
            }

            // Encontrar el último contacto exitoso
            const lastSuccessfulContact = item.contacts.find(c => c.exitoso)?.fecha;
            
            // Si no hay contacto exitoso, no puede estar "Al día"
            if (!lastSuccessfulContact && activeFilter === 'ok') {
                return false;
            }

            // Verificar si tiene contactos exitosos en el mes actual
            const thisMonth = new Date().getMonth();
            const thisYear = new Date().getFullYear();
            const hasSuccessfulContactThisMonth = item.contacts.some(contact => {
                const contactDate = parseDate(contact.fecha);
                return contact.exitoso && 
                       contactDate &&
                       contactDate.getMonth() === thisMonth && 
                       contactDate.getFullYear() === thisYear;
            });

            const daysSinceLastSuccess = lastSuccessfulContact ? 
                getDaysSince(lastSuccessfulContact) : 999;

            switch (activeFilter) {
                case 'urgent':
                    return daysSinceLastSuccess >= 30;
                case 'warning':
                    return daysSinceLastSuccess >= 15 && daysSinceLastSuccess < 30;
                case 'ok':
                    return hasSuccessfulContactThisMonth;
                default:
                    return true;
            }
        });
    }, [followUpData, activeFilter, searchQuery]);    const counts = useMemo(() => {
        return followUpData.reduce((acc, item) => {
            acc.all++;

            // Encontrar el último contacto exitoso
            const lastSuccessfulContact = item.contacts.find(c => c.exitoso)?.fecha;
            
            // Verificar si tiene contactos exitosos en el mes actual
            const thisMonth = new Date().getMonth();
            const thisYear = new Date().getFullYear();
            const hasSuccessfulContactThisMonth = item.contacts.some(contact => {
                const contactDate = parseDate(contact.fecha);
                return contact.exitoso && 
                       contactDate &&
                       contactDate.getMonth() === thisMonth && 
                       contactDate.getFullYear() === thisYear;
            });

            const daysSinceLastSuccess = lastSuccessfulContact ? 
                getDaysSince(lastSuccessfulContact) : 999;

            if (hasSuccessfulContactThisMonth) {
                acc.ok++;
            } else if (daysSinceLastSuccess >= 30) {
                acc.urgent++;
            } else if (daysSinceLastSuccess >= 15) {
                acc.warning++;
            } else {
                acc.warning++; // Si no tiene contacto exitoso este mes, va a pendientes
            }

            return acc;
        }, { all: 0, urgent: 0, warning: 0, ok: 0 });
    }, [followUpData]);

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Historial de Seguimientos</h2>
                <div className="text-sm text-gray-500">
                    Total: {followUpData.length} beneficiarios
                </div>
            </div>

            <FilterTabs 
                activeFilter={activeFilter} 
                onFilterChange={setActiveFilter}
                counts={counts}
            />

            <SearchBar 
                value={searchQuery}
                onChange={setSearchQuery}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredData.map(({ beneficiary, contacts, lastSuccessfulContact }) => (
                    <BeneficiaryCard
                        key={beneficiary}
                        beneficiary={beneficiary}
                        contacts={contacts}
                        lastSuccessfulContact={lastSuccessfulContact}
                    />
                ))}
            </div>

            {filteredData.length === 0 && (
                <div className="text-center py-12">
                    <p className="text-gray-500">
                        {searchQuery 
                            ? 'No se encontraron beneficiarios que coincidan con la búsqueda'
                            : 'No hay beneficiarios en esta categoría'}
                    </p>
                </div>
            )}
        </div>
    );
}

export default FollowUpHistory;
