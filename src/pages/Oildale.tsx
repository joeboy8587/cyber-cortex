import React from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { OildaleOperationsHub } from '@/components/dashboard/OildaleOperationsHub';

const Oildale: React.FC = () => {
  return (
    <DashboardLayout>
      <OildaleOperationsHub />
    </DashboardLayout>
  );
};

export default Oildale;
