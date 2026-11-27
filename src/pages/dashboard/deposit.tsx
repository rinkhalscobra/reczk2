import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { DepositForm } from "@/components/dashboard/DepositForm";
import { TransferLayout } from "@/components/client/TransferLayout";
const DepositPage = () => (
  <DashboardLayout>
    <TransferLayout mode="deposit">
      <DepositForm />
    </TransferLayout>
  </DashboardLayout>
);
export default DepositPage;
