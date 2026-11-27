import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { WithdrawForm } from "@/components/dashboard/WithdrawForm";
import { TransferLayout } from "@/components/client/TransferLayout";
const WithdrawPage = () => (
  <DashboardLayout>
    <TransferLayout mode="withdraw">
      <WithdrawForm />
    </TransferLayout>
  </DashboardLayout>
);
export default WithdrawPage;
