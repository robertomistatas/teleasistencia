import React from 'react';

function StatsDisplay({ title, value, icon, subtitle = null, percentage = null }) {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            <div className="flex items-center justify-between mb-2">
                {icon && <div className="flex-shrink-0">{icon}</div>}
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
            </div>
            <div className="flex items-baseline">                <div>
                    <p className="text-3xl font-bold text-gray-700 dark:text-gray-200">
                        {typeof value === 'number' ? value.toLocaleString() : value || 0}
                    </p>
                    {subtitle && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {subtitle}
                        </p>
                    )}
                    {percentage !== null && (
                        <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                            ({percentage}%)
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default React.memo(StatsDisplay);
